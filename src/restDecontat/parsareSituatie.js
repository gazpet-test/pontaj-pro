// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/parsareSituatie.js — parsarea DETERMINISTĂ (fără AI, fără BD) a situației de lucrări detaliate (XLS/XLSX,
// modelul Transgaz: cantitate în perioadă / luna curentă, cumulat, preț unitar, valoare; rândul OS; „diverse”) și a devizului
// unui act adițional / NR / NCS (prin parseDeviz, cu semnul cantităților păstrat). Rulează în browser și în Node (teste,
// tura de noapte — Task 6 folosește ACELAȘI modul).
//
// Contract (plan Task 3): parseSituatieExcel(arrayBuffer) -> { antet: {nr_situatie, luna, an}, linii: [{obiect_cod, deviz_cod, nr,
//   cod, denumire, um, cantitate_perioada, cantitate_cumulat_doc, pret_unitar, valoare, tip_rand}], total }.
// În plus (L12 — nimic nu dispare tăcut): total_doc (totalul tipărit, dacă există), diferenta_total, foi, coloane (ce coloană s-a
//   luat pentru ce), fara_miscare + fara_miscare_randuri (rânduri de articol fără cantitate și fără valoare în perioadă), ignorate
//   (rânduri de text, cu motiv), probleme (rânduri cu cifre care NU au putut deveni linii, FOI de detaliu nerecunoscute și TOATE
//   încălcările invariantului de contabilizare — vezi contabilizare.js), avertismente (linii păstrate, dar de privit: valoare ≠
//   cantitate × preț), complet (= probleme goale; false = rezultatul nu e situația întreagă), foi_nerecunoscute, foi_fara_tabel,
//   contabilizare (pe foaie: câte rânduri pe fiecare clasă), reconciliere (r7: totalurile de control găsite, suma, toleranța, verdictul).
// RECONCILIEREA CU TOTALUL DOCUMENTULUI (review #1165 r6 → r7, decizia chat-ului — plasa principală, peste invariant): `complet: true`
//   DOAR dacă documentul are un total de control recunoscut (rândul TOTAL dovedit al foii de detaliu; un „Total …” cu un singur număr pe
//   recapitulație / copertă) ȘI suma valorilor liniilor citite (cu OS / diverse, cu semn) = acel total, cu toleranța 0,01 lei × linii (max
//   1 leu). Fără total → problemă „fără total de control”; diferență → problemă cu diferența în lei și foaia / rândul. Prinde orice articol
//   cu valoare pierdut, indiferent de forma rândului (contabilizare.js reconciliazaTotal — aceeași funcție și pentru devizul AA).
// INVARIANT (review #1165 r5): fiecare rând ne-gol al fiecărei foi primește exact o clasă (antet / index / titlu / sectiune / articol /
//   os / diverse / fara_miscare / total / ignorat cu motiv / problema), iar un rând care arată a articol și nu e acoperit (linie, total,
//   fără mișcare, problemă) intră în `probleme` cu foaia și rândul — verificat la final de verificaContabilizare, aceeași funcție pe care
//   o folosește și parseDevizModificare (prin devizParser). Fără excepții tăcute: nici deasupra antetului, nici în foi sărite, nici după total.
// Fiecare linie poartă și `foaie` + `rand` (rândul Excel, de la 1) pentru trasabilitate; spre RPC se trimit DOAR CAMPURI_LINIE_RPC.
// Alt format (fără antetele de mai sus) = eroare „format nerecunoscut …” cu ce s-a găsit și ce lipsește, NU linii goale (L12, L18).
// Numerele: numar / eNumeric din contabilizare.js (o singură definiție; parseNumar = helperul EXISTENT, L17): RO / EN, semn + / −,
// text nenumeric = NaN → problemă, nu 0. Cantitățile NU se convertesc aici (UM-ul brut rămâne pe linie; conversia = potrivire.js + BD).
// ═══════════════════════════════════════════════════════════════════════════
import { parseDeviz } from '../devizParser.js'
import {
  textAntet, text, eNumeric, numar, RE_NUMAR_AMBIGUU, eRandGol, eRandIndex, eRandDate, randCandidat, eMetaDocument, TIPARE_META_DOCUMENT, eTotalDovedit, RE_TOTAL,
  totalDeControlFaraAntet, reconciliazaTotal, MOTIV_FARA_CONTROL_VALOARE, tipRand, verificaContabilizare, randuriDeLaA1,
} from './contabilizare.js'
import { clasificaColoana, antetDinTitluri, celuleFoaie, blocAntet, CLASE_TABEL, familie } from './antet.js'

// re-exportate (o singură definiție, în contabilizare.js / antet.js; testele și ecranul le iau de aici)
export { textAntet, eNumeric, numar, RE_NUMAR_AMBIGUU, randCandidat, eMetaDocument, TIPARE_META_DOCUMENT, eTotalDovedit, totalDeControlFaraAntet, reconciliazaTotal, tipRand, randuriDeLaA1, clasificaColoana, antetDinTitluri }

/** Câmpurile unei linii acceptate de fn_rest_decontat_confirma_situatie (plus cheie / potrivire, puse de ecran după confirmare). */
export const CAMPURI_LINIE_RPC = ['obiect_cod', 'deviz_cod', 'nr', 'cod', 'denumire', 'um', 'cantitate_perioada', 'cantitate_cumulat_doc', 'pret_unitar', 'valoare', 'tip_rand']
export const COLOANE_OBLIGATORII = ['denumire', 'um', 'cantitate_perioada', 'pret_unitar', 'valoare']
// Detecția antetului / tabelului parcurge ÎNTREAGA foaie (tot `!ref`), fără limită de rânduri (review #1165 r2 P1): o limită ar
// transforma un tabel aflat mai jos într-o „copertă” dovedită și liniile lui ar dispărea tăcut, cu `complet: true` (L12, L18).
// Clasificarea coloanelor, calificativele și blocul de antet stau în antet.js (o singură definiție, folosită și de devizul AA Excel — r7).

const rot = (x, z = 2) => Math.round(x * 10 ** z) / 10 ** z

/**
 * Găsește blocul de antet al unei foi (rânduri 0-based [inceput, sfarsit], inclusiv) și coloanele pe clase, căutând în TOATE
 * rândurile foii (nicio fereastră: antetul poate sta după zeci de rânduri de note / titluri; lățimea se ia tot din toate rândurile).
 * rows = sheet_to_json(header:1, blankrows:true, defval:''); merges = sheet['!merges'] (celulele unite primesc valoarea din stânga-sus).
 * Întoarce { ok: true, inceput, sfarsit, primulRandDate, coloane } sau { ok: false, cel_mai_bun: {rand, gasite, lipsesc, ambigue,
 * neconsumate, context_exclus?} | null, tabel, candidat }.
 * Blocul (antet.js blocAntet) = tot șirul neîntrerupt de rânduri de antet în jurul frunzei. `neconsumate` = coloane ale blocului al căror
 * text de antet conține un calificativ (contract / cumulat / perioadă / lună …) dar NU primește nicio clasă (ex. „contract” singur peste o
 * coloană goală): contextul de antet neconsumat face foaia NERECUNOSCUTĂ (raportată), niciodată „Cantitate” simplă = perioada tăcut.
 * `context_exclus` (r7) = rândul de deasupra blocului cu calificative dar ținut afară de o celulă numerică („contract | … | Revizia | 1”):
 * tot foaie nerecunoscută, cu diagnosticul (calificativul n-a ajuns pe coloane).
 * `tabel` (doar la ok: false) = primul rând care arată ca un antet de TABEL de articole — cel puțin 2 familii de coloane de tabel
 * (cod / denumire / um / cantitate / preț / valoare; „nr” singur nu ajunge, un titlu „Situație nr. 7” e „nr”) urmat de cel puțin un
 * rând cu cifre — sau null. `candidat` (doar la ok: false) = primul RÂND CANDIDAT de articol (vezi randCandidat), independent de orice
 * antet: { rand, motiv, total } sau null; un TOTAL DE CONTROL fără antet („Total general | 1137”, totalDeControlFaraAntet) nu e candidat —
 * e totalul recapitulației, verificat la reconciliere. O foaie cu `tabel` SAU cu `candidat` și fără antet recunoscut e o FOAIE DE DETALIU
 * NERECUNOSCUTĂ: parseSituatieExcel o raportează în `probleme` (L12), nu o sare tăcut. Coperta = ok: false cu cel_mai_bun, tabel și
 * candidat toate null: pe TOATĂ foaie nu există nici antet, nici rând de articol.
 */
export function recunoasteAntet(rows, merges = []) {
  const foaie = celuleFoaie(rows, merges)
  const { randAntet } = foaie
  let celMaiBun = null, tabel = null, candidat = null, candidati = 0
  for (let r = 0; r < rows.length; r++) {
    const frunza = randAntet(r)
    // rând candidat de articol (independent de antet): numărat pe toată foaia, primul e raportat; totalul de control al recapitulației nu e candidat
    const motivCandidat = totalDeControlFaraAntet(frunza) ? null : randCandidat(frunza)
    if (motivCandidat) { candidati++; if (!candidat) candidat = { rand: r + 1, motiv: motivCandidat } }
    if (eRandGol(frunza) || eRandDate(frunza)) continue
    const clase = frunza.map(clasificaColoana)
    const familiiTabel = new Set(clase.filter(k => CLASE_TABEL.has(k)).map(familie))
    if (!tabel && familiiTabel.size >= 2 && rows.slice(r + 1).some(rr => rr && eRandDate(rr))) tabel = { rand: r + 1, gasite: [...new Set(clase.filter(Boolean))] }
    const familii = new Set(clase.map(familie).filter(Boolean))
    if (familii.size < 3) continue
    // blocul: TOT șirul neîntrerupt de rânduri de antet deasupra (grupuri, calificative) și dedesubt (calificative) — fără fereastră
    const { inceput, sfarsit, texteColoane, peClase, neconsumate, context_exclus } = blocAntet(rows, r, foaie)
    const una = k => (peClase.get(k) || []).length === 1 ? peClase.get(k)[0] : -1
    const coloane = { nr: una('nr'), cod: una('cod'), denumire: una('denumire'), um: una('um'), pret_unitar: una('pret_unitar'), cantitate_perioada: -1, cantitate_cumulat: una('cantitate_cumulat'), valoare: -1 }
    const ambigue = []
    for (const k of ['denumire', 'um', 'pret_unitar', 'cantitate_perioada', 'cantitate_cumulat', 'valoare']) if ((peClase.get(k) || []).length > 1) ambigue.push(k)
    // cantitate în perioadă: explicită; altfel „Cantitate” simplă DOAR dacă există o coloană de cumulat (atunci cea simplă e perioada) —
    // și numai când blocul n-a lăsat niciun calificativ neconsumat (altfel foaia e nerecunoscută, vezi condiția de mai jos)
    if ((peClase.get('cantitate_perioada') || []).length === 1) coloane.cantitate_perioada = peClase.get('cantitate_perioada')[0]
    else if (!peClase.has('cantitate_perioada') && (peClase.get('cantitate') || []).length === 1 && coloane.cantitate_cumulat >= 0) coloane.cantitate_perioada = peClase.get('cantitate')[0]
    if ((peClase.get('valoare') || []).length === 1) coloane.valoare = peClase.get('valoare')[0]
    const gasite = Object.keys(coloane).filter(k => coloane[k] >= 0)
    const lipsesc = COLOANE_OBLIGATORII.filter(k => coloane[k] < 0)
    if (lipsesc.length === 0 && ambigue.length === 0 && neconsumate.length === 0 && !context_exclus) {
      let primulRandDate = sfarsit + 1
      while (primulRandDate < rows.length && (eRandIndex(rows[primulRandDate]) || eRandGol(rows[primulRandDate]))) primulRandDate++
      return { ok: true, inceput, sfarsit, primulRandDate, coloane, texteColoane }
    }
    if (!celMaiBun || gasite.length > celMaiBun.gasite.length) celMaiBun = { rand: r + 1, gasite, lipsesc, ambigue, neconsumate, ...(context_exclus ? { context_exclus } : {}) }
  }
  return { ok: false, cel_mai_bun: celMaiBun, tabel, candidat: candidat ? { ...candidat, total: candidati } : null }
}

const RE_OBIECT = /^obiect(?:ul)?\s*[:.\-]?\s*([a-z0-9][a-z0-9./-]*)\s*[:.\-]?\s*(.*)$/
const RE_DEVIZ = /^deviz(?:ul)?(?:\s+(?:oferta|ofertă))?\s*[:.\-]?\s*([a-z0-9][a-z0-9./-]*)\s*[:.\-]?\s*(.*)$/

/**
 * O foaie → linii + clasa fiecărui rând ne-gol (pentru invariant). La ok: false (foaie nerecunoscută / copertă) toate rândurile ne-gole
 * primesc o clasă onestă (meta_document = antetul documentului; titlu = text fără cifre pe copertă; ignorat cu motivul foii), iar
 * candidații de articol îi scoate la `probleme` verificaContabilizare, în parseSituatieExcel.
 */
function liniiDinFoaie(nume, rows, merges) {
  const a = recunoasteAntet(rows, merges)
  const clase = []
  const cls = (r, clasa, motiv) => clase.push(motiv ? { rand: r + 1, clasa, motiv } : { rand: r + 1, clasa })
  if (!a.ok) {
    const motiv = a.cel_mai_bun ? 'foaie nerecunoscută: antet aproape bun, dar nu modelul Transgaz' : a.tabel ? 'foaie nerecunoscută: tabel de articole fără antetul modelului Transgaz'
      : a.candidat ? 'foaie nerecunoscută: rânduri de articol fără niciun antet de tabel' : 'copertă: rând cu cifre, fără formă de articol'
    const coperta = !a.cel_mai_bun && !a.tabel && !a.candidat
    // totalul de control al recapitulației / copertei (r7): „Total general | 1137” = clasa total + valoare pentru reconciliere (ultimul de pe foaie)
    const totaluri = []
    rows.forEach((row, r) => {
      if (eRandGol(row)) return
      const t = totalDeControlFaraAntet(row)
      if (t) { cls(r, 'total'); totaluri.push({ rand: r + 1, ...t }); return }
      if (eMetaDocument(row)) cls(r, 'meta_document'); else if (coperta && !eRandDate(row)) cls(r, 'titlu'); else cls(r, 'ignorat', motiv)
    })
    return { ok: false, cel_mai_bun: a.cel_mai_bun, tabel: a.tabel, candidat: a.candidat, clase, total_control: totaluri.length ? totaluri[totaluri.length - 1] : null }
  }
  const c = a.coloane
  const titluri = rows.slice(0, a.inceput).map(r => r.map(text).filter(Boolean).join(' ')).filter(Boolean)
  // deasupra antetului: antetul documentului = meta_document; alt text fără cifre = titlu; cu cifre = ignorat cu motiv (un rând de articol
  // de aici îl scoate invariantul la probleme)
  for (let r = 0; r < a.inceput; r++) { if (eRandGol(rows[r])) continue; if (eMetaDocument(rows[r])) cls(r, 'meta_document'); else if (eRandDate(rows[r])) cls(r, 'ignorat', 'deasupra antetului, cu cifre'); else cls(r, 'titlu') }
  for (let r = a.inceput; r <= a.sfarsit; r++) if (!eRandGol(rows[r])) cls(r, 'antet')
  for (let r = a.sfarsit + 1; r < a.primulRandDate; r++) if (!eRandGol(rows[r])) cls(r, 'index')
  const linii = [], ignorate = [], probleme = [], avertismente = [], sectiuni = [], fara_miscare_randuri = []
  let total_doc = null, total_control = null, obiect = { cod: '', nume: '' }, deviz = { cod: '', nume: '' }
  const nrCel = r => (c.nr >= 0 ? text(rows[r][c.nr]) : '')
  const problema = (r, p) => { probleme.push({ foaie: nume, rand: r + 1, ...p }); cls(r, 'problema') }
  for (let r = a.primulRandDate; r < rows.length; r++) {
    const row = rows[r]
    if (!row || eRandGol(row)) continue
    const rand = r + 1
    const den = text(row[c.denumire]), cod = c.cod >= 0 ? text(row[c.cod]) : '', um = text(row[c.um])
    const brut = { q: row[c.cantitate_perioada], qc: c.cantitate_cumulat >= 0 ? row[c.cantitate_cumulat] : '', p: row[c.pret_unitar], v: row[c.valoare] }
    const q = numar(brut.q), qc = numar(brut.qc), p = numar(brut.p), v = numar(brut.v)
    const areCifre = [q, qc, p, v].some(x => x != null)
    const dn = textAntet(den), cn = textAntet(cod), nrn = textAntet(nrCel(r))
    // rând de secțiune („Obiectul: 01 …”, „Deviz oferta 0101 …”) în oricare din coloanele nr / cod / denumire
    const sectiune = re => {
      for (const src of [den, cod, nrCel(r)]) {
        const n = textAntet(src), m = n.match(re)
        // numele: din textul original (același număr de caractere după normalizare), ca să nu-l pierdem în litere mici
        if (m) return { cod: m[1].replace(/[.:-]+$/, ''), nume: src.length === n.length && n.endsWith(m[2]) ? src.slice(src.length - m[2].length).trim() : text(m[2]) }
      }
      return null
    }
    let s
    if ((s = sectiune(RE_OBIECT))) { obiect = s; deviz = { cod: '', nume: '' }; sectiuni.push({ rand, tip: 'obiect', ...s }); cls(r, 'sectiune'); continue }
    if ((s = sectiune(RE_DEVIZ))) { deviz = s; sectiuni.push({ rand, tip: 'deviz', ...s }); cls(r, 'sectiune'); continue }
    // TOTAL doar cu dovadă (review #1165 r5 P1-2): eticheta „Total …” ȘI fără cod de articol, fără UM din lista comună, fără cantitate;
    // „[2, B1, Total station montaj, m, 3, 3, 10, 30]” NU e total — merge mai departe ca articol (cu avertisment) sau problemă
    const etichetaTotal = RE_TOTAL.test(dn) || RE_TOTAL.test(cn) || RE_TOTAL.test(nrn)
    if (etichetaTotal && eTotalDovedit({ etichete: [den, cod, nrCel(r)], cod, um, cantitati: [q, qc] })) {
      // totalul de control al foii (r7) = ULTIMUL rând TOTAL dovedit cu valoare (un „Total general” după subtotaluri pe obiecte)
      if (v != null && Number.isFinite(v)) { total_doc = v; total_control = { rand, eticheta: [den, cod, nrCel(r)].find(e => RE_TOTAL.test(textAntet(e))), valoare: v }; cls(r, 'total') }
      else if (v != null) problema(r, { motiv: 'totalul tipărit nu e număr', text: text(brut.v) })
      else cls(r, 'total')
      continue
    }
    if (!areCifre && !um) { ignorate.push({ foaie: nume, rand, text: [nrCel(r), cod, den].filter(Boolean).join(' '), motiv: 'text fără cifre în coloanele cantitate / preț / valoare și fără UM' }); cls(r, 'ignorat', 'text fără cifre în coloanele cantitate / preț / valoare și fără UM'); continue }
    if (!den && !cod) { problema(r, { motiv: 'rând cu cifre, fără denumire și fără cod' }); continue }
    const nan = Object.entries({ cantitate_perioada: q, cantitate_cumulat_doc: qc, pret_unitar: p, valoare: v }).filter(([, x]) => Number.isNaN(x))
    if (nan.length) { problema(r, { motiv: `număr neinterpretabil: ${nan.map(([k]) => k).join(', ')}`, cod, denumire: den }); continue }
    // text cu UN singur fel de separator și grupuri exacte de 3 cifre („2.000”, „12,345”): mii sau zecimale? — nu ghicim (L17)
    const ambigue = Object.entries({ cantitate_perioada: brut.q, cantitate_cumulat_doc: brut.qc, pret_unitar: brut.p, valoare: brut.v })
      .filter(([, x]) => typeof x === 'string' && RE_NUMAR_AMBIGUU.test(x.trim()))
    if (ambigue.length) { problema(r, { motiv: `număr ambiguu (mii sau zecimale?): ${ambigue.map(([k, x]) => `${k} „${x.trim()}”`).join(', ')}`, cod, denumire: den }); continue }
    if (q == null && v == null) { fara_miscare_randuri.push({ foaie: nume, rand, nr: nrCel(r), cod, denumire: den, um }); cls(r, 'fara_miscare'); continue }
    if (!um) { problema(r, { motiv: 'UM lipsă', cod, denumire: den }); continue }
    const tip = tipRand(den, cod)
    if (v == null) { problema(r, { motiv: 'valoare lipsă (cantitate fără valoare)', cod, denumire: den }); continue }
    if (q == null && tip === 'articol') { problema(r, { motiv: 'cantitate în perioadă lipsă (valoare fără cantitate)', cod, denumire: den }); continue }
    if (q == null) avertismente.push({ foaie: nume, rand, motiv: `rând ${tip} fără cantitate (valoare forfetară)`, denumire: den })
    if (etichetaTotal) avertismente.push({ foaie: nume, rand, motiv: 'denumirea începe cu „Total”, dar rândul are cod / UM / cantitate — citit ca articol, nu ca total', cod, denumire: den })
    if (q != null && p != null && Math.abs(q * p - v) > Math.max(0.05, Math.abs(v) * 0.001)) {
      avertismente.push({ foaie: nume, rand, motiv: 'valoare ≠ cantitate × preț unitar', cod, denumire: den, calculat: rot(q * p), valoare: v })
    }
    linii.push({
      obiect_cod: obiect.cod, deviz_cod: deviz.cod, nr: nrCel(r), cod, denumire: den, um,
      cantitate_perioada: q, cantitate_cumulat_doc: qc, pret_unitar: p, valoare: v, tip_rand: tip,
      foaie: nume, rand, obiect_nume: obiect.nume, deviz_nume: deviz.nume,
    })
    cls(r, tip)
  }
  return { ok: true, titluri, linii, ignorate, probleme, avertismente, sectiuni, fara_miscare: fara_miscare_randuri.length, fara_miscare_randuri, total_doc, total_control, coloane: c, antet_rand: a.inceput + 1, clase }
}

/** antetul documentului din mai multe foi: valorile pe care foile le dau diferit NU se aleg (null) și se raportează (identitatea
 *  situației nu o decide prima foaie); câmpurile pe care o singură foaie le dă se iau de acolo */
export function antetDinFoi(anteturi) {
  const antet = { nr_situatie: null, luna: null, an: null }, conflicte = []
  for (const k of Object.keys(antet)) {
    const valori = [...new Set(anteturi.map(a => a.antet[k]).filter(v => v != null))]
    if (valori.length === 1) antet[k] = valori[0]
    else if (valori.length > 1) conflicte.push({ camp: k, valori: anteturi.filter(a => a.antet[k] != null).map(a => `${a.foaie}: ${a.antet[k]}`) })
  }
  return { antet, conflicte }
}

const peRand = (x, y) => x.rand - y.rand

/**
 * Situația de lucrări detaliată din XLS/XLSX (modelul Transgaz). Toate foile cu antet recunoscut se citesc (o foaie pe obiect e
 * un caz comun); >1 foaie = avertisment (de verificat că nu e și un centralizator). Fără antet recunoscut nicăieri → Error
 * „format nerecunoscut …”; antet recunoscut dar nicio linie → Error (o situație goală nu intră tăcut).
 * Foile se împart în trei (L12, review #1165 r1 P1): `foi` (antet recunoscut, citite), `foi_nerecunoscute` (au un TABEL de articole —
 * vezi recunoasteAntet.tabel —, un antet aproape bun dar NU modelul Transgaz, sau RÂNDURI CANDIDATE de articol fără niciun antet —
 * recunoasteAntet.candidat, review #1165 r3 P1: fiecare intră în `probleme`, liniile ei lipsesc din rezultat) și `foi_fara_tabel`
 * (coperta / titluri / goale: excepția legitimă, fără problemă). O foaie e „fără tabel” DOAR dacă pe TOATĂ foaia (fiecare rând din
 * `!ref`, review #1165 r2 P1) nu există nici un rând care arată a antet de tabel, nici un rând candidat de articol.
 * Peste toate, INVARIANTUL (review #1165 r5, contabilizare.js): fiecare rând ne-gol al fiecărei foi (citite, nerecunoscute, coperte)
 * are exact o clasă, iar fiecare rând candidat de articol neacoperit (deasupra antetului, în foile sărite, oriunde) e o problemă cu
 * foaia și rândul. `complet` = probleme.length === 0 — o singură definiție: tot ce avea formă de articol (rând sau foaie) a devenit
 * linie / total / fără mișcare; false = rezultatul NU e situația întreagă, ecranul nu-l tratează ca atare fără ca omul să vadă problemele.
 */
export async function parseSituatieExcel(arrayBuffer) {
  const _x = await import('xlsx-js-style')
  const XLSX = _x.default?.read ? _x.default : _x
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const foi = [], foi_nerecunoscute = [], foi_fara_tabel = [], anteturi = [], contabilizare = {}, problemeNerecunoscute = {}, controale = []
  let linii = [], ignorate = [], probleme = [], avertismente = [], sectiuni = [], fara_miscare_randuri = [], coloane = {}
  let total_doc = null, cuTotal = 0
  for (const nume of wb.SheetNames) {
    const sheet = wb.Sheets[nume]
    const rows = randuriDeLaA1(XLSX, sheet)
    const f = liniiDinFoaie(nume, rows, (sheet && sheet['!merges']) || [])
    // invariantul de contabilizare pe FIECARE foaie (citită, nerecunoscută sau copertă), pe rândurile brute
    const inv = verificaContabilizare(nume, rows, f.clase)
    contabilizare[nume] = inv.sumar
    if (!f.ok) {
      if (f.total_control) controale.push({ foaie: nume, ...f.total_control, sursa: 'recapitulatie' })
      if (f.cel_mai_bun) foi_nerecunoscute.push({ foaie: nume, ...f.cel_mai_bun })
      else if (f.tabel) foi_nerecunoscute.push({ foaie: nume, rand: f.tabel.rand, gasite: f.tabel.gasite, lipsesc: COLOANE_OBLIGATORII.filter(k => !f.tabel.gasite.includes(k)), ambigue: [], neconsumate: [] })
      else if (f.candidat) foi_nerecunoscute.push({ foaie: nume, rand: f.candidat.rand, gasite: [], lipsesc: [...COLOANE_OBLIGATORII], ambigue: [], neconsumate: [], fara_antet: { motiv: f.candidat.motiv, randuri: f.candidat.total } })
      else foi_fara_tabel.push(nume)
      // rândurile de articol ale foii sărite (fiecare, cu rândul lui) — după problema de foaie, mai jos; pe copertă nu pot exista (altfel n-ar fi copertă)
      if (foi_fara_tabel.includes(nume)) probleme = probleme.concat(inv.probleme)
      else problemeNerecunoscute[nume] = inv.probleme
      continue
    }
    foi.push(nume)
    coloane[nume] = f.coloane
    anteturi.push({ foaie: nume, antet: antetDinTitluri(f.titluri) })
    linii = linii.concat(f.linii); ignorate = ignorate.concat(f.ignorate); probleme = probleme.concat([...f.probleme, ...inv.probleme].sort(peRand))
    avertismente = avertismente.concat(f.avertismente); sectiuni = sectiuni.concat(f.sectiuni); fara_miscare_randuri = fara_miscare_randuri.concat(f.fara_miscare_randuri)
    if (f.total_doc != null) { total_doc = (total_doc ?? 0) + f.total_doc; cuTotal++ }
    if (f.total_control) controale.push({ foaie: nume, ...f.total_control, sursa: 'detaliu', suma_foaie: rot(f.linii.reduce((s, l) => s + l.valoare, 0)), linii_foaie: f.linii.length })
  }
  const descrie = n => (n.fara_antet
    ? `foaia „${n.foaie}”, rândul ${n.rand}: rând de articol (${n.fara_antet.motiv}) fără niciun antet de tabel recunoscut — ${n.fara_antet.randuri} ${n.fara_antet.randuri === 1 ? 'rând candidat' : 'rânduri candidate'} pe foaie`
    : `foaia „${n.foaie}”, rândul ${n.rand}: găsite [${n.gasite.join(', ')}], lipsesc [${n.lipsesc.join(', ')}]${n.ambigue?.length ? `, ambigue [${n.ambigue.join(', ')}]` : ''}${n.neconsumate?.length ? `, antet neconsumat [${n.neconsumate.join(', ')}]` : ''}${n.context_exclus ? `, context de antet exclus [${n.context_exclus.celule.map(c => `„${c}”`).join(', ')} (rândul ${n.context_exclus.rand}, cu cifre)]` : ''}`)
  if (foi.length === 0) {
    const cel = [...foi_nerecunoscute].sort((a, b) => b.gasite.length - a.gasite.length)[0]
    const detaliu = cel ? ` Cel mai apropiat: ${descrie(cel)}.` : ' Nicio foaie nu are un rând de antet cu Denumire / UM / Cantitate / Preț / Valoare.'
    throw new Error(`format nerecunoscut: nu am găsit antetele modelului Transgaz (cantitate în perioadă, preț unitar, valoare, UM, denumire).${detaliu}`)
  }
  if (linii.length === 0) {
    throw new Error(`situația nu are nicio linie de articol (foile ${foi.join(', ')}; rânduri fără mișcare: ${fara_miscare_randuri.length}, probleme: ${probleme.length})`)
  }
  // foaie de detaliu nerecunoscută lângă una validă: problemă de foaie (de ce) + câte un rând pentru fiecare articol al ei (ce lipsește), nu tăcere (L12, L18)
  for (const n of foi_nerecunoscute) {
    probleme.push({ foaie: n.foaie, rand: n.rand, motiv: n.fara_antet
      ? `foaie de detaliu nerecunoscută — are rânduri de articol, dar niciun antet de tabel; liniile ei LIPSESC din rezultat (${descrie(n)})`
      : `foaie de detaliu nerecunoscută — are tabel de articole, dar nu modelul Transgaz; liniile ei LIPSESC din rezultat (${descrie(n)})` })
    probleme = probleme.concat(problemeNerecunoscute[n.foaie] || [])
  }
  if (foi.length > 1) avertismente.push({ motiv: `${foi.length} foi cu antet recunoscut (${foi.join(', ')}) — verifică să nu fie și un centralizator care dublează liniile` })
  if (cuTotal > 0 && cuTotal < foi.length) avertismente.push({ motiv: `rând TOTAL găsit doar în ${cuTotal} din ${foi.length} foi — totalul tipărit e parțial` })
  const { antet, conflicte } = antetDinFoi(anteturi)
  for (const c of conflicte) avertismente.push({ motiv: `foile dau valori diferite pentru ${c.camp} (${c.valori.join('; ')}) — câmpul rămâne de completat de om`, camp: c.camp })
  const total = rot(linii.reduce((s, l) => s + l.valoare, 0))
  // RECONCILIEREA CU TOTALUL DOCUMENTULUI (r7, plasa principală): suma liniilor citite = totalul de control (al foilor de detaliu — pe foaie
  // sau pe document — ori al recapitulației), cu toleranța de rotunjire; altfel problemă (diferența în lei, foaia / rândul) → complet: false
  const reconciliere = reconciliazaTotal({ suma: total, nLinii: linii.length, controale, foi })
  probleme = probleme.concat(reconciliere.probleme)
  return {
    antet, linii, total,
    total_doc, diferenta_total: total_doc == null ? null : rot(total - total_doc), reconciliere,
    foi, foi_nerecunoscute, foi_fara_tabel, complet: probleme.length === 0,
    coloane, sectiuni, fara_miscare: fara_miscare_randuri.length, fara_miscare_randuri, ignorate, probleme, avertismente, contabilizare,
  }
}

/**
 * Devizul unui act adițional / NR / NCS (DOCX sau XLS/XLSX): refolosește parseDeviz (catalogul F3) și PĂSTREAZĂ semnul
 * cantităților (diminuările sunt negative; „doar diferențe” se adună cu semn în BD) — DOAR aici, prin opțiunea explicită
 * { cuSemn: true }; catalogul (CatalogDevizPanel) apelează parseDeviz fără opțiune și sare linia negativă ca înainte.
 * { antetOriunde: true }: pe Excel antetul se caută în TOATĂ foaia (nu în primele 30 de rânduri ale catalogului), ca un deviz cu note
 * lungi deasupra tabelului să nu fie citit ca „fără articole” (aceeași clasă ca limita de 80 de rânduri din recunoasteAntet).
 * { contabilizare: true } (review #1165 r5): parseDeviz întoarce { articole, probleme, contabilizare } — pe Excel, ACELAȘI invariant
 * (verificaContabilizare) ca la situație: fiecare rând ne-gol are o clasă, foile fără antet și rândurile cu cifre sărite sunt probleme
 * cu foaia și rândul; pe .docx, liniile de articol (ART_RE) fără UM cunoscută + cantitate sunt probleme, nu resurse tăcute.
 * Pe .docx, tot sub cuSemn, „Total=” se caută până la articolul următor (nu în 5 paragrafe); lipsa lui = linie `incomplet` + problemă.
 * Fără articole = eroare (cu problemele găsite), nu listă goală. `complet` = probleme.length === 0 (aceeași definiție ca la situație).
 * Reconcilierea (r7): pe .docx suma „Total=” ale articolelor trebuie să fie egală cu ultimul total al devizului neconsumat de un articol
 * („Total deviz …”, „TOTAL GENERAL …”; lipsa = „fără total de control”); pe Excel devizul are doar cantități → problemă „fără control pe
 * valoare” (nu există valoare de verificat) → complet: false, explicit.
 */
export async function parseDevizModificare(file) {
  const rez = await parseDeviz(file, { cuSemn: true, antetOriunde: true, contabilizare: true })
  const arts = rez?.articole
  const probleme = Array.isArray(rez?.probleme) ? [...rez.probleme] : []
  if (!Array.isArray(arts) || arts.length === 0) {
    const detaliu = probleme.length ? ` (${probleme.length} ${probleme.length === 1 ? 'rând problematic' : 'rânduri problematice'}; primul: ${probleme[0].motiv})` : ''
    throw new Error(`format nerecunoscut: niciun articol de deviz în „${file?.name || 'fișier'}”${detaliu}`)
  }
  const linii = arts.map((a, i) => {
    const q = a.cantitate
    if (q == null || !Number.isFinite(q)) probleme.push({ poz: i + 1, cod: a.cod, denumire: a.denumire, motiv: 'cantitate lipsă sau neinterpretabilă' })
    // .docx: articol fără „Total=” până la articolul următor (review #1165 r3) — linia rămâne, marcată, și intră în probleme (L12)
    if (a.incomplet) probleme.push({ poz: i + 1, cod: a.cod, denumire: a.denumire, motiv: `valoare lipsă: ${a.incomplet}` })
    return { ...a, cantitate: q == null || !Number.isFinite(q) ? null : q }
  })
  // RECONCILIEREA CU TOTALUL DEVIZULUI (r7): .docx → suma „Total=” ale articolelor = ultimul „Total deviz / TOTAL GENERAL …” neconsumat
  // (rez.totaluri, articoleDinParagrafe); lipsa lui = „fără total de control”. Excel (doar cantități, rez.totaluri == null) → „fără control
  // pe valoare”: nu există valoare de verificat, deci rezultatul nu poate fi declarat complet.
  const cuValoare = linii.filter(l => l.valoare != null && Number.isFinite(l.valoare))
  let reconciliere = null
  if (rez.totaluri == null) probleme.push({ motiv: `${MOTIV_FARA_CONTROL_VALOARE}: devizul are doar cantități (fără „Total=” pe articole / fără coloană de valoare), suma articolelor nu poate fi verificată cu un total de control` })
  else {
    // ULTIMUL total neconsumat din document = totalul de control (după „Total deviz 0101” / „Total deviz 0102” vine „TOTAL GENERAL”)
    const ultim = rez.totaluri.length ? [{ ...rez.totaluri[rez.totaluri.length - 1], sursa: 'deviz' }] : []
    reconciliere = reconciliazaTotal({ suma: rot(cuValoare.reduce((s, l) => s + l.valoare, 0)), nLinii: cuValoare.length, controale: ultim })
    probleme.push(...reconciliere.probleme)
  }
  return { linii, negative: linii.filter(l => l.cantitate != null && l.cantitate < 0).length, probleme, complet: probleme.length === 0, contabilizare: rez.contabilizare || {}, reconciliere }
}
