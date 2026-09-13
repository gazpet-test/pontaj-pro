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

const num = v => (v == null || v === '') ? null : Number(v)
const fmt = n => Math.round(n).toLocaleString('ro-RO')
const rel = (a, b) => a ? Math.abs(b - a) / a : (b ? Infinity : 0)

export function controlCantitati({ lista_f3_m, lista_c6_m, memoriu_m, plansa_m, grafic_fronturi_m }) {
  const f3 = num(lista_f3_m), gr = num(grafic_fronturi_m)
  const base = { k: 'cantitati', lista_f3_m: f3, grafic_m: gr, diferenta_m: null, neclarificate: [] }
  if (f3 == null) {
    const alt = [['memoriu', num(memoriu_m)], ['planșe', num(plansa_m)], ['C6', num(lista_c6_m)]].filter(([, v]) => v != null)
    return { ...base, stare: 'block',
      detalii: 'lipsește lista de cantități F3 în ERP — graficul nu are punct de decontat'
        + (alt.length ? ` (există doar ${alt.map(([n, v]) => `${n} ${fmt(v)} m`).join(', ')})` : '') }
  }
  // Surse informative care diferă de F3 peste toleranță: de rezolvat prin clarificare, nu de ales.
  const neclarificate = [['memoriu', num(memoriu_m)], ['planșe', num(plansa_m)], ['C6', num(lista_c6_m)]]
    .filter(([, v]) => v != null && rel(f3, v) > H2_TOLERANTA_RELATIVA)
    .map(([n, v]) => `${n} ${fmt(v)} m`)
  const notaClar = neclarificate.length ? ` — diferență nerezolvată prin clarificare: ${neclarificate.join(', ')} vs F3 ${fmt(f3)} m` : ''
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
export function normalizeazaRef(t = '') {
  const m = String(t).toLowerCase().match(/^\s*(anex|formular|cap|plan)[a-zăș.]*\s*(?:nr\.?\s*)?([0-9]+[a-z]?|[ivxlc]+)\b/)
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

export function clasificaFrazaParticipare(fraza) {
  const t = String(fraza || '').toLowerCase()
  if (!/asocier|asocia[țt]|subcontract/.test(t)) return 'irelevanta'
  // Negare explicită: „Pentru realizarea lucrarilor, nu se vor folosi subcontractori." (p. 58).
  if (/\bnu\s+(se\s+)?(vor|va)\s+(fi\s+)?(folosi|utiliza|subcontracta)|f[ăa]r[ăa] subcontract/.test(t)) return 'negare'
  // Condițional / clauză generală: se citește ÎNAINTE de marcajele operaționale, ca „în cazul
  // asocierilor... prin grija liderului" să nu treacă drept structură activă.
  if (/[îi]n cazul|dac[ăa][^a-ză]|ulterior|acordul beneficiarului|acordul autorit|propus dup[ăa]|se vor aviza|se aplic[ăa]/.test(t)) return 'generica'
  // Structură operațională activă: descrie cum FUNCȚIONEAZĂ asocierea, nu ce s-ar întâmpla dacă.
  if (/echip|comitet|organigram|director|responsabil|factur|centraliz|compartiment|departament|coordon|raport|fiecare (asociat|subcontract)/.test(t)) return 'operationala'
  return 'generica'
}

export function controlParticipare({ participanti, fraze_asociere }) {
  const pe = { asociat: [], subcontractant: [], tert_sustinator: [], furnizor: [], proiectant: [] }
  for (const x of participanti || []) {
    const i = String(x).indexOf('|')
    if (i < 0) continue
    const rol = String(x).slice(0, i), nume = String(x).slice(i + 1)
    if (pe[rol]) pe[rol].push(nume)
  }
  const fraze = (fraze_asociere || []).map(f => ({ text: String(f), cls: clasificaFrazaParticipare(f) }))
  const op = fraze.filter(f => f.cls === 'operationala')
  const neg = fraze.filter(f => f.cls === 'negare')
  const zice = {
    asociere: op.some(f => /asocier|asocia[țt]/i.test(f.text)),
    subcontract: op.some(f => /subcontract/i.test(f.text)),
  }
  const base = { k: 'participare', pe, fraze, operationale: op.length, generice: fraze.length - op.length - neg.length }
  const declarat = Object.entries(pe).filter(([, v]) => v.length)
    .map(([rol, v]) => `${ROLURI_PARTICIPARE[rol]}: ${v.join(', ')}`)
  const probleme = []
  if (zice.asociere && !pe.asociat.length) probleme.push('capitolele descriu o asociere care funcționează (echipe, comitet, facturi pe asociat), dar niciun asociat nu e declarat')
  if (zice.subcontract && !pe.subcontractant.length) probleme.push('capitolele descriu subcontractori care lucrează, dar niciun subcontractant nu e declarat')
  // Contradicția din pagina 58: aceeași propunere neagă și descrie.
  if (neg.length && op.some(f => /subcontract/i.test(f.text)))
    probleme.push('aceeași propunere spune că nu se folosesc subcontractori și, în altă parte, descrie cum lucrează ei')
  if (probleme.length && pe.tert_sustinator.length)
    probleme.push(`${pe.tert_sustinator.join(', ')} e terț susținător, ceea ce nu înseamnă nici asociat, nici subcontractant`)
  if (!probleme.length) return { ...base, stare: 'ok',
    detalii: (declarat.length ? declarat.join(' · ') : 'niciun partener declarat')
      + (fraze.length ? ` · ${plural(fraze.length, 'formulare', 'formulări')} despre asociere sau subcontractare, toate generale sau condiționale` : ' · capitolele nu pomenesc asociere sau subcontractare') }
  return { ...base, stare: 'warn',
    detalii: probleme.join(' · ') + (declarat.length ? ` (declarat: ${declarat.join('; ')})` : '')
      + ` · ${plural(op.length, 'formulare operațională', 'formulări operaționale')}, ${base.generice} generale — citește contextul` }
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
