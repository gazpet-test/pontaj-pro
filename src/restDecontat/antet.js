// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/antet.js — BLOCUL DE ANTET al unui tabel Excel (coloane pe clase, calificative, context), O SINGURĂ definiție (L19,
// review #1165 r6 P1-2): folosită de parsareSituatie.recunoasteAntet (modelul Transgaz) ȘI de devizParser.parseDevizExcel sub opțiunea
// { contabilizare: true } (devizul AA / NR / NCS). Până în r6, AA Excel lua „prima coloană care conține «cantitat»”, fără blocul de
// calificative: un rând „contract | … | Observații” deasupra lui „Cantitate | Cantitate cumulat” făcea cantitatea CONTRACTULUI cantitatea
// AA-ului, cu complet: true. Acum ambele parsere citesc același bloc:
//   - rândul blocului (eRandAntet): fără celule numerice, fără formă de articol, nu antet de document (meta_document), cu cel puțin o celulă
//     de antet (cuvânt-cheie de coloană sau calificativ); blocul = șirul neîntrerupt de astfel de rânduri în jurul frunzei;
//   - textul fiecărei coloane = celulele blocului de pe coloană (cu umplerea spre dreapta a grupurilor fără `!merges`) → clasificaColoana;
//   - `neconsumate` = coloane cu calificativ în text dar fără clasă (nimeni nu le folosește) → antetul NU e sigur;
//   - `context_exclus` (r7) = rândul IMEDIAT deasupra blocului care are un calificativ de antet („contract”, „cumulat” …) dar n-a intrat în
//     bloc (are o celulă numerică: „contract | … | Revizia | 1”) și nu e nici antet de document, nici rând de articol → antetul NU e sigur:
//     calificativul ar fi trebuit să schimbe sensul coloanelor; apelantul refuză foaia cu diagnosticul, în loc să citească „Cantitate” simplă.
// Rulează în browser și în Node. Fără BD, fără AI.
// ═══════════════════════════════════════════════════════════════════════════
import { textAntet, text, eRandGol, eRandDate, eRandIndex, randCandidat, eMetaDocument, eRandArticolTare } from './contabilizare.js'

export const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const tokeni = s => textAntet(s).split(/[^a-z0-9]+/).filter(Boolean)

const RE_CUMUL = /cumul|de la inceput|la zi|pana la data|pana in prezent/
// „anterior” / „precedent” = realizat PÂNĂ LA situația precedentă (fără perioada curentă): nu e cumulatul la zi și nu e perioada — clasă
// proprie (cantitate_anterior / valoare_anterior), recunoscută (calificativul e consumat), niciodată folosită drept perioadă sau cumulat
const RE_ANTERIOR = /anterio|precedent/ // „anterior” / „anterioară” / „precedent(ă)”
const RE_CONTRACT = /contract|ofert|deviz|prevazut|aprobat|initial/
const RE_PERIOADA = /perioad|lun[aă]|lunar|curent|realizat|executat|decontat|aceasta situati|situatia curenta/
// calificativele de antet (review #1165 r5 P1-3 → r6): un rând de deasupra / dedesubtul frunzei cu cel puțin o astfel de celulă (sau o
// clasă de coloană) e rând al blocului de antet; un calificativ rămas fără clasă la clasificarea coloanelor = `neconsumate` → foaie nerecunoscută
export const RE_CALIFICATIV = /perioad|luna|lunar|curent|cumul|contract|ofert|realizat|executat|decontat|total|unitar|lei|ron|anterio|precedent|prezent/

/**
 * Clasa unei coloane din textul (concatenat) al antetului ei: 'nr' | 'cod' | 'denumire' | 'um' | 'cantitate_contract' |
 * 'cantitate_perioada' | 'cantitate_cumulat' | 'cantitate_anterior' | 'cantitate' (fără calificativ) | 'pret_unitar' | 'valoare' |
 * 'valoare_cumulat' | 'valoare_anterior' | 'valoare_contract' | null. Ordinea contează: valoare → preț → cantitate (un antet „Valoare
 * (cantitate × preț)” e valoare); anterior / precedent bate perioada și cumulatul („Cantitate realizată anterior” nu e realizată în perioadă).
 */
export function clasificaColoana(textColoana) {
  const t = textAntet(textColoana)
  if (!t) return null
  const tok = new Set(tokeni(t))
  const anterior = RE_ANTERIOR.test(t), cumul = !anterior && RE_CUMUL.test(t), contract = RE_CONTRACT.test(t), perioada = !anterior && RE_PERIOADA.test(t)
  if (/valoar/.test(t) || tok.has('val')) return anterior ? 'valoare_anterior' : contract && !perioada && !cumul ? 'valoare_contract' : cumul ? 'valoare_cumulat' : 'valoare'
  if (/pret/.test(t) || tok.has('pu') || tok.has('p')) return 'pret_unitar'
  if (/cantit/.test(t) || tok.has('cant')) {
    if (anterior) return 'cantitate_anterior'
    if (cumul) return 'cantitate_cumulat'
    if (contract && !perioada) return 'cantitate_contract'
    return perioada ? 'cantitate_perioada' : 'cantitate'
  }
  if (tok.has('um') || (tok.has('u') && tok.has('m')) || /unitat|\bunit\b/.test(t)) return 'um'
  if (tok.has('cod') || tok.has('codul') || tok.has('simbol') || tok.has('simbolul') || tok.has('indicativ')) return 'cod'
  if (/denumir|descrier/.test(t) || tok.has('lucrare') || tok.has('lucrari') || tok.has('lucrarii') || tok.has('articol') || tok.has('articolul') || tok.has('capitol')) return 'denumire'
  if (tok.has('nr') || tok.has('crt') || tok.has('poz') || tok.has('pozitie') || tok.has('pozitia')) return 'nr'
  return null
}

/** Antetul documentului din rândurile de deasupra tabelului: nr. situație, luna, anul (null când nu se găsesc). */
export function antetDinTitluri(randuriText) {
  const antet = { nr_situatie: null, luna: null, an: null }
  for (const t0 of randuriText) {
    const t = textAntet(t0)
    if (!t) continue
    if (antet.nr_situatie == null) {
      const m = t.match(/situati[ae][^0-9]{0,60}?\b(?:nr|numar(?:ul)?|no)\b\s*(\d{1,4}[a-z]?)/) || t.match(/situati[ae]\s*(?:de\s+(?:lucrari|plata)\s*)?(\d{1,4}[a-z]?)\b/)
      if (m) antet.nr_situatie = m[1]
    }
    if (antet.luna == null) {
      const i = LUNI.findIndex(l => new RegExp(`\\b${l}\\b`).test(t))
      if (i >= 0) antet.luna = i + 1
    }
    if (antet.an == null) { const m = t.match(/\b(20\d{2})\b/); if (m) antet.an = Number(m[1]) }
  }
  return antet
}

// titlul documentului („Situație de lucrări nr. 7 / octombrie 2026”) lipit de antet (fără rând gol) s-ar clasifica „denumire” (tokenul
// „lucrari”) și ar intra în blocul de antet, stricând coloana de denumire → o celulă care dă nr. situației e titlu, nu rând de antet
const eTitluDocument = c => antetDinTitluri([c]).nr_situatie != null
/** celulă de ANTET nevidă (clasă de coloană sau calificativ: „perioadă”, „cumulat”, „contract”…): fără cifre (o dată / un an / un număr
 *  de contract sunt titluri, nu antet) și nu titlul documentului */
export const eCelulaAntet = c => c !== '' && c != null && !/\d/.test(textAntet(c)) && !eTitluDocument(c) && (clasificaColoana(c) != null || RE_CALIFICATIV.test(textAntet(c)))
// celulă DOAR de calificativ („contract”, „cumulat”, „în perioadă”, „Total realizat”, „anterior”): toate cuvintele ei sunt calificative sau
// cuvinte de legătură — fără cifre. Un text cu alte cuvinte („Executant lucrări speciale”, „Lucrări executate luna octombrie”) nu e calificativ:
// e titlu / denumire, nu schimbă sensul coloanelor. Folosită la contextul exclus (r7), nu la apartenența la bloc.
const RE_LEGATURA = /^(in|de|la|pe|a|al|si|din|pana|zi|inceput(ul)?|aceasta|situati[ae]|curs|anului|lunii)$/
export const eCelulaCalificativ = c => {
  if (c === '' || c == null) return false
  const t = textAntet(c)
  if (!t || /\d/.test(t)) return false
  const cuvinte = t.split(/[^a-z]+/).filter(Boolean)
  return cuvinte.length > 0 && cuvinte.some(w => RE_CALIFICATIV.test(w)) && cuvinte.every(w => RE_CALIFICATIV.test(w) || RE_LEGATURA.test(w))
}
/** rând al BLOCULUI de antet (deasupra sau dedesubtul rândului-frunză): fără nicio celulă numerică și cu CEL PUȚIN o celulă de antet
 *  (cuvânt-cheie de coloană sau calificativ). O celulă nerecunoscută („Observații”) NU taie blocul (review #1165 r5 P1-3: cu regula
 *  „toate celulele”, rândul „contract | … | Observații” ieșea din bloc, iar „Cantitate” simplă devenea tăcut perioada). Blocul = ȘIRUL
 *  NEÎNTRERUPT de astfel de rânduri în jurul frunzei, fără limită de rânduri (review #1165 r4 P1: fereastra de 2 rânduri). Un rând
 *  candidat de articol (cod + UM, fără numere) nu e rând de antet, oricât ar conține cuvinte-cheie („B1 | Lucrare B | m”); nici antetul
 *  documentului („Contract nr. | 30/2025”, r7) — altfel eticheta lui s-ar vărsa peste coloane („Contract nr. Valoare” → valoare_contract). */
export const eRandAntet = row => !eRandGol(row) && !eRandDate(row) && !randCandidat(row) && !eMetaDocument(row) && row.some(eCelulaAntet)
export const CLASE_TABEL = new Set(['cod', 'denumire', 'um', 'pret_unitar', 'cantitate', 'cantitate_perioada', 'cantitate_cumulat', 'cantitate_anterior', 'cantitate_contract', 'valoare', 'valoare_cumulat', 'valoare_anterior', 'valoare_contract'])
export const familie = cls => (cls && cls.startsWith('cantitate') ? 'cantitate' : cls && cls.startsWith('valoare') ? 'valoare' : cls)

/**
 * Celulele unei foi cu celulele unite rezolvate (merges = sheet['!merges']: celulele unite primesc valoarea din stânga-sus) și lățimea
 * din TOATE rândurile. Întoarce { latime, cel(r, c), randAntet(r) } — randAntet(r) = rândul r completat la lățimea foii.
 */
export function celuleFoaie(rows, merges = []) {
  const uniri = new Map()
  for (const m of merges || []) {
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) uniri.set(`${r},${c}`, [m.s.r, m.s.c])
  }
  const cel = (r, c) => {
    const u = uniri.get(`${r},${c}`)
    const v = u ? rows[u[0]]?.[u[1]] : rows[r]?.[c]
    return v == null ? '' : v
  }
  let latime = 0
  for (const row of rows) if (row && row.length > latime) latime = row.length
  const randAntet = r => Array.from({ length: latime }, (_, c) => cel(r, c))
  return { latime, cel, randAntet }
}

/**
 * Blocul de antet în jurul rândului-frunză r (0-based): { inceput, sfarsit, texteColoane, peClase (Map clasă → [coloane]), neconsumate,
 * context_exclus }. Fără fereastră. `context_exclus` = null sau { rand (de la 1), celule: ['contract', …] } când rândul imediat deasupra
 * blocului are calificative de antet dar n-a putut intra în bloc (are cifre) și nu e antet de document, nici rând de articol.
 */
export function blocAntet(rows, r, { latime, randAntet }) {
  let inceput = r, sfarsit = r
  while (inceput - 1 >= 0 && eRandAntet(randAntet(inceput - 1))) inceput--
  while (sfarsit + 1 < rows.length && eRandAntet(randAntet(sfarsit + 1))) sfarsit++
  const bloc = []
  for (let rr = inceput; rr <= sfarsit; rr++) bloc.push(randAntet(rr))
  // umplere spre dreapta a grupurilor (celule unite fără `!merges`): în rândurile de deasupra ultimului, doar în coloanele
  // în care un rând de mai jos are text (nu se varsă în coloane complet goale)
  for (let i = 0; i < bloc.length - 1; i++) {
    let ultim = ''
    for (let c = 0; c < latime; c++) {
      const v = text(bloc[i][c])
      if (v) ultim = v
      else if (ultim && bloc.slice(i + 1).some(rr => text(rr[c]))) bloc[i][c] = ultim
      else ultim = ''
    }
  }
  const texteColoane = Array.from({ length: latime }, (_, c) => bloc.map(rr => text(rr[c])).filter(Boolean).join(' '))
  const peClase = new Map()
  texteColoane.forEach((t, c) => { const k = clasificaColoana(t); if (k) peClase.set(k, [...(peClase.get(k) || []), c]) })
  // context de antet NECONSUMAT: o coloană a blocului cu un calificativ în text, dar fără clasă (nimeni n-a folosit-o)
  const neconsumate = []
  texteColoane.forEach((t, c) => { if (t && clasificaColoana(t) == null && RE_CALIFICATIV.test(textAntet(t))) neconsumate.push(`„${t}” (coloana ${c + 1})`) })
  // context de antet EXCLUS (r7): rândul imediat deasupra blocului are celule DOAR de calificativ („contract”, „cumulat”, „Total realizat”)
  // dar n-a intrat în bloc (o celulă numerică l-a ținut afară: „contract | … | Revizia | 1”) și nu e antet de document (lista albă), nici
  // rând de articol (cod / UM + numere) → calificativele lui nu au ajuns pe coloane: antetul nu e sigur, apelantul refuză foaia cu acest
  // diagnostic. Un titlu cu alte cuvinte și o cifră („Lucrări executate luna octombrie | 2026”) nu e context: rămâne candidat / titlu.
  let context_exclus = null
  if (inceput - 1 >= 0) {
    const vecin = randAntet(inceput - 1)
    if (!eRandGol(vecin) && !eRandIndex(vecin) && !eMetaDocument(vecin) && !eRandArticolTare(vecin)) {
      const celule = vecin.filter(eCelulaCalificativ).map(c => text(c))
      if (celule.length) context_exclus = { rand: inceput, celule }
    }
  }
  return { inceput, sfarsit, texteColoane, peClase, neconsumate, context_exclus }
}
