// ════════════════════════════════════════════════════════════════
// ofertareControale.js — controalele deterministe din dosarul Hoghilag (Sprint 3).
//
// Fiecare control e o funcție PURĂ peste date deja în ERP. Nu LLM, nu fuzzy: un verdict aici e
// reproductibil și explicabil, cu ambele surse și diferența. Regulile vin din greșeli REALE
// găsite de Jakarinos într-o ofertă CÂȘTIGĂTOARE (Hoghilag, 90 pct): că au trecut o dată nu
// înseamnă că trec și data viitoare.
// ════════════════════════════════════════════════════════════════

/**
 * H2 — conservarea cantităților. Regula (Răzvan, 13.09): la grafic NU există „baza memoriu / planșă".
 * Referința unică e LISTA DE CANTITĂȚI F3 (pe obiecte): pe ea punem banii, ea se decontează. Memoriu,
 * planșe sau C6 care diferă de F3 sunt diferențe care TREBUIAU rezolvate prin clarificare înainte de
 * grafic — se afișează ca rezervă, nu se aleg. Varianta B: suma pe F3; C6 e doar control (ΣF3 = C6).
 *
 * Toleranța e pentru ROTUNJIRI (5 m la 30 km = 0,02%), nu pentru compensări: la Hoghilag
 * -19 Prod / +18 Valchid dădeau -1 la total și tot era greșit.
 */
export const H2_TOLERANTA_RELATIVA = 0.001   // 0,1 %

// Cerinte care interzic CUMULUL DE FUNCTII (Domnesti #4090: „O persoana nu poate indeplini in mod cumulativ
// mai multe functii"). ACEEASI expresie ca in v_ofertare_pt_conformitate.interzice_cumul — daca o schimbi
// aici, schimb-o si in view. Restransa la functii/roluri: simplul „cumulativ" da fals pozitiv (statistica SSM).
export const REGEX_INTERZICE_CUMUL = String.raw`(cumul\w*\s+(de\s+)?(mai\s+multe\s+)?(func[tț]i|rol|post|pozi[tț]i)|(func[tț]i|rol|post)\w*[^.]{0,40}cumul|nu poate (îndeplini|indeplini)|(o|aceea[sș]i) persoan[aă] nu poate|nu se (admite|accept[aă]) cumul)`

const num = v => (v == null || v === '') ? null : Number(v)
const fmt = n => Math.round(n).toLocaleString('ro-RO')
const rel = (a, b) => a ? Math.abs(b - a) / a : (b ? Infinity : 0)

// R5 (Copilot 25.09.2026): „extras" ≠ aprobat. F3 e referința de decontat a porții: dacă rândurile ei de rețea
// NU sunt validate de un om (status='validat'), suma lor e o transcriere automată, nu o cantitate aprobată =>
// BLOCK. Câmpurile *_nevalidate vin din v_ofertare_cantitati_nevalidate (propus în
// docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql), lipite peste v_ofertare_pt_stare ca neconfirmatele.
// Lipsă / invalid (view neaplicat, eroare) = control INDISPONIBIL = block cât timp F3 e folosită (≠ zero).
// Memoriu / planșe / C6 rămân surse INFORMATIVE; când au rânduri nevalidate, cifra lor poartă „(nevalidat)".
const nevalidat = nv => (Number(nv) > 0 ? ' (nevalidat)' : '')
// R5 condiția 2 (Copilot 26.09.2026): rândul invalidat / nevalidat nu dispare TACIT din H2. Pe lângă F3:
//  - rândurile INVALIDATE ieșite din setul de rețea (regula aprobării le-a scos din „validat”, iar unitatea / categoria schimbată
//    le-a scos și din filtrul qm, deci lista_f3_m / fronturile au scăzut fără semnal) => BLOCK, numite cu metrii lor;
//  - rândurile de rețea FĂRĂ tip de sursă, nevalidate (nu intră în F3, nici în memoriu / planșe) => niciun „ok” verde: WARN
//    „INCOMPLET, de reverificat”, numite cu metrii lor;
//  - câmpurile noi absente (view-ul în versiunea veche) => control parțial, WARN (nu „ok”).
// Lista rândurilor: 📋 Cantități → „N nevalidate” (filtrul).
export function controlCantitati(x) {
  const r = controlCantitatiF3(x)
  const inv = num(x.invalidate_in_afara_retea), invM = num(x.invalidate_in_afara_retea_m)
  const ft = num(x.fara_tip_nevalidate), ftM = num(x.fara_tip_nevalidate_m)
  const txtInv = inv > 0 ? ` · ${inv === 1 ? '1 rând INVALIDAT a ieșit' : `${inv} rânduri INVALIDATE au ieșit`} din setul de rețea (${invM != null ? `${fmt(invM)} m` : 'metri necunoscuți'}; ` +
    `aprobarea veche nu mai e valabilă, unitatea / categoria s-a schimbat) — nu mai intră în F3 și nici în fronturi; reverifică în 📋 Cantități („N nevalidate”)` : ''
  const txtFt = ft > 0 ? ` · INCOMPLET, de reverificat: ${ft} ${ft === 1 ? 'rând de rețea fără tip de sursă, nevalidat' : 'rânduri de rețea fără tip de sursă, nevalidate'} ` +
    `(${ftM != null ? `${fmt(ftM)} m` : 'metri necunoscuți'}) — nu intră în F3 și nici în comparație (📋 Cantități → „N nevalidate”)` : ''
  const partial = Number.isInteger(num(x.lista_f3_nevalidate)) && (x.invalidate_in_afara_retea === undefined || x.fara_tip_nevalidate === undefined)
    ? ' · control parțial: nu știm dacă lipsesc rânduri fără tip de sursă / invalidate (v_ofertare_cantitati_nevalidate în versiunea veche)' : ''
  const out = { ...r, invalidate_in_afara_retea: inv, fara_tip_nevalidate: ft, incomplet: !!(inv > 0 || ft > 0 || partial) }
  if (!txtInv && !txtFt && !partial) return out
  const stare = inv > 0 ? 'block' : r.stare === 'ok' ? 'warn' : r.stare
  return { ...out, stare, detalii: r.detalii + txtInv + txtFt + partial }
}
function controlCantitatiF3({ lista_f3_m, lista_c6_m, memoriu_m, plansa_m, grafic_fronturi_m,
                              lista_f3_nevalidate, lista_f3_nevalidate_m, lista_c6_nevalidate, memoriu_nevalidate, plansa_nevalidate }) {
  const f3 = num(lista_f3_m), gr = num(grafic_fronturi_m)
  const nvF3 = num(lista_f3_nevalidate)
  const base = { k: 'cantitati', lista_f3_m: f3, grafic_m: gr, diferenta_m: null, neclarificate: [], f3_nevalidate: nvF3 }
  const surse = [['memoriu', num(memoriu_m), memoriu_nevalidate], ['planșe', num(plansa_m), plansa_nevalidate], ['C6', num(lista_c6_m), lista_c6_nevalidate]]
  if (f3 == null) {
    const alt = surse.filter(([, v]) => v != null)
    return { ...base, stare: 'block',
      detalii: 'lipsește lista de cantități F3 în ERP — graficul nu are punct de decontat'
        + (alt.length ? ` (există doar ${alt.map(([n, v, nv]) => `${n} ${fmt(v)} m${nevalidat(nv)}`).join(', ')})` : '') }
  }
  // Surse informative care diferă de F3 peste toleranță: de rezolvat prin clarificare, nu de ales.
  const neclarificate = surse
    .filter(([, v]) => v != null && rel(f3, v) > H2_TOLERANTA_RELATIVA)
    .map(([n, v, nv]) => `${n} ${fmt(v)} m${nevalidat(nv)}`)
  const notaClar = neclarificate.length ? ` — diferență nerezolvată prin clarificare: ${neclarificate.join(', ')} vs F3 ${fmt(f3)} m` : ''
  if (!Number.isInteger(nvF3) || nvF3 < 0) return { ...base, neclarificate, stare: 'block',
    detalii: `F3 ${fmt(f3)} m, dar nu putem verifica dacă rândurile ei sunt validate de un om (controlul e indisponibil: v_ofertare_cantitati_nevalidate lipsește sau a dat eroare) — nu înseamnă că sunt nevalidate, înseamnă că nu știm` + notaClar }
  if (nvF3 > 0) {
    const mNv = num(lista_f3_nevalidate_m)
    return { ...base, neclarificate, stare: 'block',
      detalii: `F3 ${fmt(f3)} m include ${nvF3} ${nvF3 === 1 ? 'rând' : 'rânduri'} de rețea NEVALIDATE${mNv != null ? ` (${fmt(mNv)} m)` : ''} — transcrise automat, nu sunt cantități aprobate; verifică-le și validează-le (✓) în 📋 Cantități`
        + (gr != null ? ` · fronturile graficului: ${fmt(gr)} m` : '') + notaClar }
  }
  if (gr == null) return { ...base, neclarificate, stare: 'warn', detalii: 'graficul n-are fronturi definite — controlul nu se poate face' + notaClar }
  const dif = gr - f3, r = rel(f3, gr)
  if (r > H2_TOLERANTA_RELATIVA) return { ...base, neclarificate, diferenta_m: dif, stare: 'block',
    detalii: `F3 ${fmt(f3)} m vs ${fmt(gr)} m în fronturile graficului: ${dif > 0 ? '+' : ''}${fmt(dif)} m (${(r * 100).toFixed(1)} %) — graficul se face pe cantitățile de decontat` + notaClar }
  if (dif !== 0) return { ...base, neclarificate, diferenta_m: dif, stare: 'warn',
    detalii: `F3 ${fmt(f3)} m vs ${fmt(gr)} m în fronturi: ${dif > 0 ? '+' : ''}${fmt(dif)} m, sub 0,1 % — rotunjire, dar spune-o în ofertă` + notaClar }
  if (neclarificate.length) return { ...base, neclarificate, diferenta_m: 0, stare: 'warn', detalii: `${fmt(f3)} m în F3 și în grafic` + notaClar }
  return { ...base, neclarificate, diferenta_m: 0, stare: 'ok', detalii: `${fmt(f3)} m în F3 și în grafic` }
}

/**
 * H4 — garanția e un OBIECT (luni + momentul de start), nu o propoziție. La Hoghilag momentul
 * (PIF vs recepție) diferea între formular și capitol. Fapte (block): oferit < cerut; moment diferit
 * de cel cerut; capitole care pomenesc alt număr de luni decât cel oferit. Lipsa obiectului e warn
 * doar când nicio cerință nu vorbește de garanția lucrărilor; altfel e block: s-a cerut, nu s-a asumat.
 */
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
import { verificaRelatii } from './graficCPM.js'

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


/**
 * H1 — identitatea lucrării. Greșeala reală: un capitol copiat de la altă ofertă, cu numele altei
 * localități rămas în text (la Hoghilag: „Oituz și Sibioara, comuna Lumina" într-un paragraf despre
 * coordonarea proiectului).
 *
 * AVERTISMENT, NU BLOCAJ — corectat 13.09 după cercetarea Hoghilag. Prima versiune bloca pe orice
 * nume străin, ceea ce e fals: capitolul de experiență similară numește LEGITIM alte lucrări ale
 * noastre. Un nume străin are patru citiri (contaminare, experiență, referință, document terț) și
 * numai omul le poate distinge. Poarta îl arată, omul îl clasifică.
 *
 * LIMITĂ ȘTIUTĂ: dicționarul e format din licitațiile NOASTRE. Un contract care nu există în ERP
 * (cazul Oituz–Sibioara) nu e detectat. Pentru el ar trebui și lucrările din execuție.
 */
export function controlIdentitate({ identitate_straine }) {
  const straine = [...new Set((identitate_straine || []).filter(Boolean))]
  if (!straine.length) return { k: 'identitate', stare: 'ok', straine: [], detalii: 'capitolele nu pomenesc nicio localitate sau entitate din altă licitație' }
  return { k: 'identitate', stare: 'warn', straine,
    detalii: `capitolele pomenesc ${straine.join(', ')} — nume din alte licitații ale noastre. Citește fiecare: contaminare din copy-paste, experiență similară, referință sau document al unui terț. Doar prima se corectează în text` }
}

/**
 * H6 — numerele cheie (branșamente / racorduri) trebuie să fie aceleași peste tot. La Hoghilag:
 * 372 branșamente în obiectiv vs 371 în repartizarea echipelor (Prod 129/110, Valchid 243/261) și
 * 758 racorduri în Planul de inspecție. Compensarea între localități NU e reconciliere.
 *
 * Controlul NU ghicește care număr e totalul: în text stau laolaltă totalul și defalcările, iar o
 * regulă „mai multe numere = greșeală" ar fi falsă. Fapt (block): cerința spune un număr, iar
 * capitolele n-au niciunul egal cu el. Restul e rezervă: numerele se arată omului, să le sumeze el.
 *
 * CONFLICTUL DE SURSE SE ARATĂ PRIMUL — adăugat 13.09 după cercetarea Hoghilag. Documentația
 * autorității conținea ea însăși 371 într-un loc și 372 în altul, posibil pentru obiecte diferite
 * semantic. Prima versiune verifica doar dacă un capitol coincide cu VREUN număr din cerințe, deci
 * spunea „în regulă" și ascundea exact conflictul care trebuia ridicat prin clarificare. Nu se alege
 * automat o valoare, nici cea mai frecventă: sursele care diferă cer rezolvare umană.
 */
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

/**
 * HOG-08 — ofertant, asociat, subcontractant și terț susținător NU sunt sinonime. La Hoghilag:
 * participare individuală, HABAU terț susținător, niciun asociat și niciun subcontractant declarat,
 * dar textul propunerii vorbea despre „echipa asocierii" și „fiecare subcontractor". Contaminare de
 * șablon într-o zonă unde cuvântul are consecințe juridice.
 *
 * NICIODATĂ BLOCANT. Cuvântul „subcontractant" apare legitim în clauze condiționale („dacă se va
 * subcontracta ulterior, cu acordul autorității"). Poarta arată nepotrivirea, omul o citește.
 */
export const ROLURI_PARTICIPARE = {
  asociat: 'asociat', subcontractant: 'subcontractant', tert_sustinator: 'terț susținător',
  furnizor: 'furnizor', proiectant: 'proiectant',
}
// Acordul la numeral: in romana e 1 formulare, dar 2 formulari. Fara asta poarta scria „1 formulări”.
const plural = (n, unu, multe) => `${n} ${n === 1 ? unu : multe}`

/**
 * Analiza finala Prunisor-Jupa §5: in PT apar formule de tip
 * „Asociatului / Subcontractorului / Furnizorului" — insiruiri de roluri din formulare standard si
 * proceduri generice. Ele NU sunt declaratii operationale si nu au voie sa declanseze contradictie
 * fata de §4.5 „asociere: NU ESTE CAZUL".
 *
 * Semnul dupa care se recunosc, si care se vede in document: doua roluri lipite printr-un slash —
 * marca locului gol dintr-un sablon, unde se taie ce nu e cazul. O propozitie adevarata despre
 * lucrarea asta nu se scrie cu bara oblica.
 *
 * ATENTIE la limita: contaminarea de la Hoghilag („Echipa de proiect a asocierii va prezenta
 * rapoarte", „Fiecare subcontractor va avea o echipa proprie") NU are slash si are verb
 * operational — ramane operationala si trebuie sa se vada in continuare.
 */
const ROL_SABLON = /(asocia[țta-zăâîș]*|subcontract[a-zăâîșț]*|furnizor[a-zăâîșț]*|prestator[a-zăâîșț]*|ofertant[a-zăâîșț]*)\s*\/\s*(asocia|subcontract|furnizor|prestator|ofertant)/
export function clasificaFrazaParticipare(fraza) {
  const t = String(fraza || '').toLowerCase()
  if (!/asocier|asocia[țt]|subcontract/.test(t)) return 'irelevanta'
  // Negare explicită: „Pentru realizarea lucrarilor, nu se vor folosi subcontractori." (p. 58).
  if (/\bnu\s+(se\s+)?(vor|va)\s+(fi\s+)?(folosi|utiliza|subcontracta)|f[ăa]r[ăa] subcontract/.test(t)) return 'negare'
  // Loc gol de șablon, citit ÎNAINTE de orice altceva: nu spune nimic despre lucrarea asta.
  if (ROL_SABLON.test(t)) return 'boilerplate'
  // Condițional / clauză generală: se citește ÎNAINTE de marcajele operaționale, ca „în cazul
  // asocierilor... prin grija liderului" să nu treacă drept structură activă.
  if (/[îi]n cazul|dac[ăa][^a-ză]|ulterior|acordul beneficiarului|acordul autorit|propus dup[ăa]|se vor aviza|se aplic[ăa]/.test(t)) return 'generica'
  // Structură operațională activă: descrie cum FUNCȚIONEAZĂ asocierea, nu ce s-ar întâmpla dacă.
  if (/echip|comitet|organigram|director|responsabil|factur|centraliz|compartiment|departament|coordon|raport|fiecare (asociat|subcontract)/.test(t)) return 'operationala'
  return 'generica'
}

/**
 * PRUNISOR-JUPA: aceeasi entitate poate avea DOUA roluri in aceeasi licitatie.
 * HABAU e declarat si subcontractant (sectiunea 4.6 — sudura automata) si tert sustinator
 * (sectiunea 4.12), in acelasi PT. La Hoghilag era doar tert sustinator. Deci multimile de roluri
 * NU sunt disjuncte, iar controlul nu are voie sa presupuna asta.
 *
 * Consecinte concrete:
 *  - fraza „X e tert sustinator, ceea ce nu inseamna nici asociat, nici subcontractant" e FALSA
 *    daca X e declarat si subcontractant. Se spune doar pentru cine e DOAR tert sustinator.
 *  - cumulul tert sustinator + subcontractant e legitim (imprumuta capacitatea SI executa) — se
 *    arata, nu se semnaleaza.
 *  - asociat + subcontractant la aceeasi entitate e contradictie: asociatul e parte din ofertant,
 *    subcontractantul e tert fata de el. Nu poate fi subcontractantul lui insusi => warn.
 *  - acelasi rol de doua ori la aceeasi entitate = dublura de introducere => warn.
 */
const cheieEntitate = n => String(n).trim().toUpperCase().replace(/\s+/g, ' ')
/**
 * PT §4.5 „asociere: NU ESTE CAZUL" e o DECLARATIE, nu o absenta de date (analiza 03).
 * Diferenta conteaza juridic: daca un capitol scrie „echipa asocierii", contradictia e fata de o
 * afirmatie formala a propunerii, nu fata de un tabel pe care cineva a uitat sa-l completeze.
 * De aceea declaratiile se citesc INAINTE de a interpreta tabelul de participanti.
 */
export const FORME_PARTICIPARE = {
  asociere: { rol: 'asociat', articulat: 'asocierea', regex: /asocier|asocia[țt]/i },
  subcontractare: { rol: 'subcontractant', articulat: 'subcontractarea', regex: /subcontract/i },
  tert_sustinator: { rol: 'tert_sustinator', articulat: 'susținerea unui terț', regex: /ter[țt] sus[țt]in/i },
}
export function controlParticipare({ participanti, participanti_acte, fraze_asociere, declaratii_participare }) {
  const pe = { asociat: [], subcontractant: [], tert_sustinator: [], furnizor: [], proiectant: [] }
  // Entitatea, nu rolul, e cheia: un rand per firma, cu toate rolurile ei pe licitatia asta.
  const entitati = new Map()
  for (const x of participanti || []) {
    const i = String(x).indexOf('|')
    if (i < 0) continue
    const rol = String(x).slice(0, i), nume = String(x).slice(i + 1)
    if (!pe[rol]) continue
    pe[rol].push(nume)
    const k = cheieEntitate(nume)
    if (!entitati.has(k)) entitati.set(k, { nume, roluri: [] })
    entitati.get(k).roluri.push(rol)
  }
  // Actul care declara rolul. Declaratia de forma ajungea la poarta cu act si pagina, rolul NU —
  // se oprea in UI. Un rol fara act trecea verde, desi tocmai asta combate analiza 03: fara act,
  // „HABAU e subcontractant" e afirmatia noastra, nu o trimitere la acordul 305/23.06.2025.
  const acte = new Map()
  for (const a of participanti_acte || []) {
    if (!a?.rol || !a?.nume) continue
    acte.set(`${a.rol}|${cheieEntitate(a.nume)}`, a)
  }
  const actul = (rol, nume) => acte.get(`${rol}|${cheieEntitate(nume)}`)
  const scrieAct = a => [a.document_sursa, a.data_document && `din ${a.data_document}`,
    a.pagina && `p. ${a.pagina}`].filter(Boolean).join(', ')
  const multiRol = [...entitati.values()].filter(e => e.roluri.length > 1)
  const doarTert = n => {
    const e = entitati.get(cheieEntitate(n))
    return e && e.roluri.length === 1 && e.roluri[0] === 'tert_sustinator'
  }
  const fraze = (fraze_asociere || []).map(f => ({ text: String(f), cls: clasificaFrazaParticipare(f) }))
  const op = fraze.filter(f => f.cls === 'operationala')
  const neg = fraze.filter(f => f.cls === 'negare')
  const sablon = fraze.filter(f => f.cls === 'boilerplate')
  const zice = {
    asociere: op.some(f => /asocier|asocia[țt]/i.test(f.text)),
    subcontract: op.some(f => /subcontract/i.test(f.text)),
  }
  const decl = new Map()
  for (const d of declaratii_participare || [])
    if (d?.forma && FORME_PARTICIPARE[d.forma] && d?.stare) decl.set(d.forma, d)
  // In verdict, rolul se scrie CU actul lui: „subcontractant: HABAU (acord nr. 305, p. 171)".
  const numeCuAct = (rol, nume) => {
    const a = actul(rol, nume), t = a && scrieAct(a)
    return nume + (t ? ` (${t})` : '')
  }
  const declarat = Object.entries(pe).filter(([, v]) => v.length)
    .map(([rol, v]) => `${ROLURI_PARTICIPARE[rol]}: ${v.map(n => numeCuAct(rol, n)).join(', ')}`)
  // Rolurile care nu trimit la niciun act. Rezerva, niciodata blocant — participarea nu blocheaza.
  const faraAct = []
  for (const [rol, v] of Object.entries(pe))
    for (const nume of v) if (!actul(rol, nume)?.document_sursa) faraAct.push(`${nume} (${ROLURI_PARTICIPARE[rol]})`)
  const base = { k: 'participare', pe, entitati: [...entitati.values()], multi_rol: multiRol, fara_act: faraAct,
    fraze, declaratii: [...decl.values()], operationale: op.length, sablon: sablon.length,
    generice: fraze.length - op.length - neg.length - sablon.length }
  const probleme = []
  for (const e of multiRol) {
    const set = new Set(e.roluri)
    if (set.size !== e.roluri.length)
      probleme.push(`${e.nume} e trecut de doua ori in acelasi rol — verifica dublura`)
    if (set.has('asociat') && set.has('subcontractant'))
      probleme.push(`${e.nume} e declarat si asociat, si subcontractant — asociatul e parte din ofertant, nu poate fi subcontractant al lui insusi`)
  }
  // Contradictiile fata de o DECLARATIE se spun primele si mai tare decat cele deduse din tabel gol.
  const unde = d => d.pagina ? ` (${d.document_sursa || 'propunerea'}, p. ${d.pagina})` : (d.document_sursa ? ` (${d.document_sursa})` : '')
  for (const [forma, d] of decl) {
    const f = FORME_PARTICIPARE[forma], declarati = pe[f.rol] || []
    if (d.stare === 'nu_e_cazul') {
      if (declarati.length)
        probleme.push(`propunerea declară că ${f.articulat} nu e cazul${unde(d)}, dar în ERP e trecut ${declarati.join(', ')} ca ${ROLURI_PARTICIPARE[f.rol]}`)
      else if (op.some(x => f.regex.test(x.text)))
        probleme.push(`propunerea declară că ${f.articulat} nu e cazul${unde(d)}, dar capitolele descriu cum funcționează`)
    } else if (d.stare === 'declarata' && !declarati.length) {
      probleme.push(`propunerea declară ${f.articulat}${unde(d)}, dar niciun ${ROLURI_PARTICIPARE[f.rol]} nu e trecut în ERP`)
    }
  }
  // Deducerile din tabel gol raman, dar numai unde NU exista declaratie pe forma aceea.
  if (zice.asociere && !pe.asociat.length && !decl.has('asociere')) probleme.push('capitolele descriu o asociere care funcționează (echipe, comitet, facturi pe asociat), dar niciun asociat nu e declarat')
  if (zice.subcontract && !pe.subcontractant.length && !decl.has('subcontractare')) probleme.push('capitolele descriu subcontractori care lucrează, dar niciun subcontractant nu e declarat')
  // Contradicția din pagina 58: aceeași propunere neagă și descrie.
  if (neg.length && op.some(f => /subcontract/i.test(f.text)))
    probleme.push('aceeași propunere spune că nu se folosesc subcontractori și, în altă parte, descrie cum lucrează ei')
  // Doar pentru cine e EXCLUSIV tert sustinator. Pe HABAU-ul de la Prunisor-Jupa (tert + subcontractant)
  // fraza ar fi minciuna.
  const numaiTert = pe.tert_sustinator.filter(doarTert)
  if (probleme.length && numaiTert.length)
    probleme.push(`${numaiTert.join(', ')} e terț susținător, ceea ce nu înseamnă nici asociat, nici subcontractant`)
  if (faraAct.length && participanti_acte)
    probleme.push(`${plural(faraAct.length, 'rol nu trimite', 'roluri nu trimit')} la niciun act: ${faraAct.join(', ')}`)
  const cumul = multiRol.map(e => `${e.nume}: ${e.roluri.map(r => ROLURI_PARTICIPARE[r]).join(' + ')}`)
  const cumulTxt = (cumul.length ? ` · rol dublu — ${cumul.join('; ')}` : '')
    + (decl.size ? ` · declarat în propunere: ${[...decl].map(([f, d]) => `${FORME_PARTICIPARE[f].articulat} ${d.stare === 'nu_e_cazul' ? 'nu e cazul' : 'da'}`).join(', ')}` : '')
  if (!probleme.length) return { ...base, stare: 'ok',
    detalii: (declarat.length ? declarat.join(' · ') : 'niciun partener declarat') + cumulTxt
      + (fraze.length ? ` · ${plural(fraze.length, 'formulare', 'formulări')} despre asociere sau subcontractare, toate generale sau condiționale` : ' · capitolele nu pomenesc asociere sau subcontractare') }
  return { ...base, stare: 'warn',
    detalii: probleme.join(' · ') + (declarat.length ? ` (declarat: ${declarat.join('; ')})` : '') + cumulTxt
      + ` · ${plural(op.length, 'formulare operațională', 'formulări operaționale')}, ${base.generice} generale`
      + (sablon.length ? `, ${plural(sablon.length, 'loc gol de șablon', 'locuri goale de șablon')} (ignorate)` : '')
      + ' — citește contextul' }
}

/**
 * HOG-02/03 — reconcilierea tronsoanelor: sursa tehnică vs activitățile din grafic.
 *
 * REGULA CENTRALĂ, dovedită pe Hoghilag: eticheta NU e cheie, perechea de noduri e. Graficul sparge
 * legitim un tronson în mai multe activități — Valchid 1-2 apare ca 1.600 + 810 = 2.410, exact cât
 * dă memoriul, iar Prod 9-10 ca 1.600 + 1.435 = 3.035. Un control care ar semnala „aceeași etichetă
 * de două ori" ar fi dat fals pozitive pe jumătate din grafic. De aceea se însumează pe pereche
 * ÎNAINTE de comparație.
 *
 * Tocmai de asta Valchid 15-16 e eroare: acolo suma dă 345, iar sursa dă 100, fiindcă cei 245 m
 * aparțin lui 15-13, care nu apare deloc. Se demonstrează prin cantitate, nu prin nume.
 *
 * FORMULARE: „graficul nu poartă cantitatea", niciodată „lucrarea a fost omisă". Controlul vede
 * documente, nu șantiere.
 */
export function perecheNoduri(a, b) {
  return [String(a).trim().toUpperCase(), String(b).trim().toUpperCase()].sort().join('-')
}
export function controlTronsoane({ tronsoane_sursa, tronsoane_grafic }) {
  const cheie = t => `${String(t.localitate || '').toUpperCase()}|${perecheNoduri(t.nod_start, t.nod_end)}`
  const sursa = new Map(), grafic = new Map()
  for (const t of tronsoane_sursa || []) {
    const k = cheie(t); sursa.set(k, (sursa.get(k) || 0) + Number(t.lungime_m || 0))
  }
  for (const t of tronsoane_grafic || []) {
    const k = cheie(t)
    const v = grafic.get(k) || { m: 0, acte: [] }
    v.m += Number(t.lungime_m || 0); if (t.id_activitate != null) v.acte.push(String(t.id_activitate))
    grafic.set(k, v)
  }
  const nume = k => k.split('|')[1] + ' (' + k.split('|')[0].toLowerCase() + ')'
  const randuri = []
  for (const [k, m] of sursa) {
    const g = grafic.get(k)
    if (!g) randuri.push({ k, stare: 'lipsa_in_grafic', sursa_m: m, grafic_m: 0,
      detalii: `${nume(k)}: ${m} m în sursă, graficul nu poartă cantitatea` })
    else if (Math.abs(g.m - m) >= 0.5) randuri.push({ k, stare: 'cantitate_diferita', sursa_m: m, grafic_m: g.m,
      detalii: `${nume(k)}: sursă ${m} m vs grafic ${g.m} m din ${g.acte.length} ${g.acte.length === 1 ? 'activitate' : 'activități'} (${g.acte.join(', ')})` })
  }
  for (const [k, g] of grafic) if (!sursa.has(k))
    randuri.push({ k, stare: 'necunoscut_in_sursa', sursa_m: 0, grafic_m: g.m,
      detalii: `${nume(k)}: ${g.m} m în grafic, fără corespondent în sursă` })

  const ts = [...sursa.values()].reduce((a, b) => a + b, 0)
  const tg = [...grafic.values()].reduce((a, b) => a + b.m, 0)
  const base = { k: 'tronsoane', randuri, total_sursa_m: ts, total_grafic_m: tg, diferenta_m: tg - ts }
  if (!sursa.size || !grafic.size) return { ...base, stare: 'warn',
    detalii: !sursa.size ? 'nu există tronsoane din sursa tehnică în ERP — controlul nu se poate face'
                         : 'graficul n-are activități de tronson — controlul nu se poate face' }
  if (!randuri.length) return { ...base, stare: 'ok',
    detalii: `${sursa.size} perechi de noduri, aceleași cantități în sursă și în grafic (${ts} m)` }
  const fapte = randuri.filter(r => r.stare !== 'necunoscut_in_sursa')
  const fmt = n => Math.round(n).toLocaleString('ro-RO')
  return { ...base, stare: fapte.length ? 'block' : 'warn',
    detalii: `${randuri.length} din ${sursa.size} perechi nu se reconciliază · total sursă ${fmt(ts)} m vs grafic ${fmt(tg)} m (${tg - ts > 0 ? '+' : ''}${fmt(tg - ts)}) · `
      + randuri.slice(0, 3).map(r => r.detalii).join(' · ') + (randuri.length > 3 ? ` · și încă ${randuri.length - 3}` : '') }
}

/**
 * PRUNIȘOR-JUPA (Transgaz) — completitudinea PACHETULUI DEPUS, nu a conținutului.
 *
 * Cazul real: Transgaz a cerut clarificare pentru fișele tehnice 18–21 (redresor protecție catodică,
 * priză de potențial, eclator, dispozitiv de drenare). Fișele EXISTAU — completate, la subcontractantul
 * ELCAS — dar n-au ajuns în propunerea depusă, fiindcă PDF-urile lor purtau semnătură digitală și
 * procesul de unire a picat. Nu a fost lipsă de conținut tehnic; a fost defect de ASAMBLARE.
 *
 * De aceea controlul ăsta e DISTINCT de controlAnexe (H5): H5 verifică dacă trimiterile din text cad
 * pe piese care există în dosar. Aici se verifică dacă piesele din opis au ajuns în fișierele efectiv
 * urcate în pachetul final. Un dosar poate trece H5 impecabil și tot să se depună fără fișa 18.
 *
 * A doua regulă, din aceeași clarificare: UN FIȘIER SEMNAT NU SE MODIFICĂ CA SĂ FIE „UNIT" în alt PDF.
 * Unirea rupe semnătura. Anexa semnată se depune ca fișier de sine stătător, legată prin opis.
 *
 * Se rulează pe pachetul asamblat: cât timp nu există pachet, controlul nu are ce verifica (warn).
 */
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


// ════════════════════════════════════════════════════════════════
// PR 1 Laza (14.09.2026) — „graficul spune adevărul"
//
// La Laza (alimentare cu apă Râșnița) PERT-ul depus avea 16 din 66 relații declarate „FS" cu
// ES(succesor) < EF(predecesor). Comisia n-a văzut — dar orice desen cu săgeți ar fi expus-o.
// Cauza reală: graficul a fost scris de mână, în Word, nu calculat. Două controale:
//   controlRelatiiGrafic — relațiile declarate și datele declarate pot fi amândouă adevărate?
//   controlGraficSursa   — piesa de grafic din pachetul depus vine dintr-o versiune înghețată?
// Al doilea e cel ieftin: ar fi prins tot, fără să citească o singură relație.
// ════════════════════════════════════════════════════════════════

// Snapshot-ul din grafic_versiuni.activitati are două forme: generat de motor
// ({id, durata_zile, predecesori:[{id,tip,lag}]}, fără es/ef declarate) sau importat dintr-o
// ofertă ({cod, durata, es, ef, predecesori:[{cod,relatie,lag}]}). Le aducem la aceeași formă.
export function normalizeazaActivitati(lista) {
  return (Array.isArray(lista) ? lista : []).map(a => ({
    cod: String(a?.cod ?? a?.id ?? ''),
    denumire: a?.denumire || '',
    durata: a?.durata ?? a?.durata_zile ?? null,
    es: a?.es ?? null, ef: a?.ef ?? null,
    predecesori: (a?.predecesori || []).map(p => ({
      cod: String(p?.cod ?? p?.id ?? ''), relatie: String(p?.relatie ?? p?.tip ?? 'FS').toUpperCase(), lag: Number(p?.lag || 0),
    })),
  })).filter(a => a.cod)
}

export function controlRelatiiGrafic({ grafic_activitati_declarate, grafic_versiune, grafic_versiune_mod }) {
  const acts = normalizeazaActivitati(grafic_activitati_declarate)
  const base = { k: 'grafic_relatii', activitati: acts.length, relatii: 0, probleme: [] }
  // Fără versiune înghețată nu avem ce verifica. NU e „ok": e „nu s-a putut verifica" — verdele
  // pe gol e exact anti-bug-ul din normalizeazaRef, în altă haină.
  if (!grafic_versiune || !acts.length) return { ...base, stare: 'warn',
    detalii: 'nicio versiune înghețată de grafic — consistența relațiilor nu s-a putut verifica' }
  // Grafic generat de motor: ES/EF nu sunt declarate, sunt calculate din relații — prin construcție
  // consistente. Se spune explicit, nu se tace.
  if (!acts.some(a => a.es != null && a.ef != null)) return { ...base, stare: 'ok',
    detalii: `versiunea ${grafic_versiune} e generată de motor (${acts.length} activități) — datele sunt calculate din relații, nu declarate; nimic de confruntat` }

  const v = verificaRelatii(acts)
  const out = { ...base, relatii: v.relatii, probleme: v.probleme, conventie: v.conventie }
  // Date declarate, dar nicio relație: un grafic fără dependențe n-are drum critic și nu poate fi
  // verificat — e o listă de date, nu o planificare. Se spune, nu trece verde.
  if (!v.relatii) return { ...out, stare: 'warn', cod: 'NO_RELATIONS_DECLARED',
    detalii: `${acts.length} activități cu ES/EF declarate, dar nicio relație de precedență — fără dependențe nu există drum critic și nimic de verificat` }
  const conflicte = v.probleme.filter(p => p.cod === 'RELATION_DATE_CONFLICT')
  const lipsa = v.probleme.filter(p => p.cod === 'MISSING_PREDECESSOR' || p.cod === 'UNKNOWN_RELATION_TYPE')
  const faraDate = v.probleme.filter(p => p.cod === 'MISSING_DATES')
  const numeste = p => `${p.predecesor}→${p.succesor} ${p.relatie}${p.lag ? (p.lag > 0 ? '+' : '') + p.lag : ''}`
    + (p.suprapunere_zile != null ? ` (începe cu ${p.suprapunere_zile} zile înainte)` : '')

  if (conflicte.length) return { ...out, stare: 'block', cod: 'RELATION_DATE_CONFLICT',
    detalii: `${conflicte.length} din ${v.relatii} relații declarate se contrazic cu datele declarate (convenție ${v.conventie}): `
      + conflicte.slice(0, 6).map(numeste).join(' · ') + (conflicte.length > 6 ? ` · +${conflicte.length - 6}` : '')
      + ' · fie relația e altfel (SS / FS cu lead), fie datele — graficul depus nu poate fi apărat cu un desen cu săgeți'
      + (lipsa.length ? ` · în plus ${lipsa.length} relații trimit la activități inexistente sau au tip necunoscut` : '') }
  if (lipsa.length) return { ...out, stare: 'block', cod: lipsa[0].cod,
    detalii: `${lipsa.length} relații trimit la activități inexistente sau au tip necunoscut: ` + lipsa.slice(0, 6).map(numeste).join(' · ') }
  if (faraDate.length) return { ...out, stare: 'warn', cod: 'MISSING_DATES',
    detalii: `${faraDate.length} relații nu s-au putut verifica — activități fără ES/EF declarate` }
  return { ...out, stare: 'ok',
    detalii: `${v.relatii} relații declarate pe ${acts.length} activități, toate consistente cu datele (convenție ${v.conventie})` }
}

// Piesa de tip grafic (Gantt / PERT / drum critic) din pachetul depus trebuie să vină dintr-o
// versiune înghețată în grafic_versiuni. Dacă nu vine, e un document făcut în afara ERP-ului —
// și atunci niciun control de consistență nu-l poate atinge. Se verifică pe numele/rolul
// fișierelor din manifest.
const PIESA_GRAFIC = /grafic|gantt|pert|drum(ul)?\s*critic|e[șs]alonare|program(ul)?\s+de\s+execu/i
export function controlGraficSursa({ pachet_fisiere, grafic_versiune, grafic_versiune_mod }) {
  const fisiere = (pachet_fisiere || []).filter(f => PIESA_GRAFIC.test(String(f?.nume || '')) || PIESA_GRAFIC.test(String(f?.rol || '')))
  const base = { k: 'grafic_sursa', piese: fisiere.map(f => f.nume) }
  if (!fisiere.length) return { ...base, stare: 'ok', detalii: 'pachetul nu conține (încă) piese de grafic' }
  if (!grafic_versiune) return { ...base, stare: 'block', cod: 'SCHEDULE_NOT_FROM_FROZEN_VERSION',
    detalii: `${plural(fisiere.length, 'piesă de grafic în pachet', 'piese de grafic în pachet')} (${fisiere.map(f => f.nume).join(', ')}), dar nicio versiune înghețată în grafic_versiuni — graficul depus e făcut în afara ERP-ului și nu poate fi verificat` }
  return { ...base, stare: 'ok',
    detalii: `${plural(fisiere.length, 'piesă de grafic', 'piese de grafic')} în pachet, versiunea înghețată ${grafic_versiune}${grafic_versiune_mod ? ` (${grafic_versiune_mod})` : ''}` }
}
