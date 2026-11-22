// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/parsareSituatie.js — parsarea DETERMINISTĂ (fără AI, fără BD) a situației de plată Transgaz în formatul F3 DOCX
// (decizia proprietarului, 22.11.2026, varianta B: citim DOAR formatul Transgaz, potrivit pe situații reale; omul confirmă în ecran,
// cu totalul citit lângă totalul din document). Rulează în browser și în Node (teste, tura de noapte — Task 6 folosește ACELAȘI modul).
//
// FORMATUL (calibrat pe 46 de devize reale din 5 fișiere, 22.11.2026 — vezi raportul de calibrare al chat-ului): un fișier .docx cu text în
// PARAGRAFE (fără tabele Word), un bloc pe deviz:
//   Obiectivul: <cod> <nr> <nume …>            (numele poate continua pe paragrafele următoare)
//   Obiectul: <cod> <nr> <nume …>              (idem)
//   Situatie de plata in luna <L> anul <AAAA>
//   Deviz <COD> <capitol> <denumire …>         (idem; „Deviz oferta <COD> …” acceptat)
//   Categoria de lucrari: … / Preturi de contractare …
//   =====…===== / „= NR. SIMBOL ART. … =” (antetul tabelului, 6 paragrafe) / =====…=====
//   <nr 3 cifre> <SIMBOL> [ <fază> ] <UM> <cantitate 3 zecimale> <PU mat> <VAL mat>      ← linia de articol
//   <denumire …> <PU man> <VAL man> / … <PU uti> <VAL uti> / <PU tra> <VAL tra>          ← 1–4 paragrafe de denumire + prețuri
//   <gr/UA> <gr tot> Total= <valoare>                                                    ← valoarea articolului
//   Cheltuieli directe din articole: / GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT TOTAL / <6 numere; ultimul = TOTAL>  ← CONTROLUL
//   … CAM, Total cheltuieli directe, indirecte, profit …
//   TOTAL GENERAL DEVIZ: <valoare, cu spațiu la mii>                                     ← totalul devizului (cu indirecte + profit)
//   TVA … / TOTAL cu TVA … / EXECUTANT BENEFICIAR / INTOCMIT VERIFICAT
// Pagini: „<COD> pag <n>” + „=====” pot apărea ORIUNDE (și în mijlocul unui articol) — sunt zgomot de paginare, nu conținut.
// Separator zecimal „.”, mii cu spațiu doar la TOTAL GENERAL / TOTAL cu TVA. Simbolul articolului poate fi alfanumeric (CP03A1, GD17A1%,
// IZFBTT) sau numeric (6426594); UM-ul rămâne BRUT pe linie („100 MC.”, „M.C.”, „BUC.”, „ORA”): conversia e a lui um.js / potrivire.js / BD.
//
// CONTROLUL (L12 — nimic nu dispare tăcut; plasa de control pe TOTAL din r7, acum pe fiecare deviz): `complet: true` DOAR dacă FIECARE
// deviz are (a) controlul „Cheltuieli directe din articole … TOTAL” găsit și EGAL cu suma „Total=” ale articolelor citite (toleranța de
// rotunjire `toleranta`: 0,01 lei × numărul de articole, cel mult 1 leu) și (b) „TOTAL GENERAL DEVIZ” găsit; altfel `complet: false`, cu
// devizul și motivul în `probleme`. În plus sunt probleme: orice paragraf care ARATĂ a început de articol (3 cifre + simbol + … + trei
// numere) și n-a fost consumat ca articol (oriunde: și în mijlocul unui articol, și în afara devizelor); un „Total=” fără articol deschis;
// un articol fără „Total=” până la următorul (linia rămâne, `incomplet`, valoare null); un deviz fără articole. `complet` = probleme.length
// === 0 — o singură definiție. Paragrafele necunoscute din zona articolelor intră în `ignorate` (vizibile, nu probleme: controlul pe sumă
// e cel care decide dacă lipsește valoare).
// Antet: luna / an din „Situatie de plata in luna L anul A” (pe deviz; la nivel de fișier doar valorile pe care TOATE devizele le dau la
// fel — altfel null + avertisment); obiect / deviz din antetul fiecărui deviz.
// Numerele: parseNumar (helperul EXISTENT, L17) pe tokenii validați de regexuri ancorate (L13). Totalurile: `total_citit` = suma articolelor,
// `total_control` = suma controalelor, `total_document` = suma „TOTAL GENERAL DEVIZ” (cu indirecte + profit — cifra din borderou).
// Excel: situațiile Transgaz NU vin în Excel → `parseSituatieExcel` / un fișier .xls(x) = refuz clar, nu ghicire (decizia 22.11.2026).
// ═══════════════════════════════════════════════════════════════════════════
import { paragrafeDinDocXml } from '../devizParser.js'
import { parseNumar } from '../izoDocumenteLogica.js'
import { norm } from '../lib/diacritice.js'

/** Câmpurile unei linii acceptate de fn_rest_decontat_confirma_situatie (plus cheie / potrivire, puse de ecran după confirmare). */
export const CAMPURI_LINIE_RPC = ['obiect_cod', 'deviz_cod', 'nr', 'cod', 'denumire', 'um', 'cantitate_perioada', 'cantitate_cumulat_doc', 'pret_unitar', 'valoare', 'tip_rand']
/** Câmpurile unei linii acceptate de fn_rest_decontat_confirma_baza (devizul AA / NR / NCS, p_linii ca tablou). */
export const CAMPURI_LINIE_RPC_BAZA = ['obiect_cod', 'obiect_nume', 'deviz_cod', 'deviz_nume', 'nr', 'cod', 'denumire', 'um', 'cantitate', 'pret_unitar', 'valoare', 'tip_rand']
/** linia F3 → obiectul pentru fn_rest_decontat_confirma_situatie: cantitatea din F3 e cantitatea PERIOADEI; cumulatul și prețul unitar nu
 *  există în F3 (null — RPC-ul le acceptă null). O linie `incomplet` (valoare null) nu se trimite: rezultatul ei nu e `complet`. */
export const liniePentruRpc = l => ({
  obiect_cod: l.obiect_cod, deviz_cod: l.deviz_cod, nr: l.nr, cod: l.cod, denumire: l.denumire, um: l.um,
  cantitate_perioada: l.cantitate, cantitate_cumulat_doc: null, pret_unitar: null, valoare: l.valoare, tip_rand: l.tip_rand,
})
/** linia F3 → obiectul pentru fn_rest_decontat_confirma_baza (deviz AA / NR / NCS). */
export const liniePentruRpcBaza = l => ({
  obiect_cod: l.obiect_cod, obiect_nume: l.obiect_nume, deviz_cod: l.deviz_cod, deviz_nume: l.deviz_nume, nr: l.nr, cod: l.cod,
  denumire: l.denumire, um: l.um, cantitate: l.cantitate, pret_unitar: null, valoare: l.valoare, tip_rand: l.tip_rand,
})

// ── toleranța de rotunjire (o singură definiție; documentată în plan / PR) ──
export const TOLERANTA_PE_LINIE_LEI = 0.01
export const TOLERANTA_MAX_LEI = 1
export const toleranta = nLinii => Math.min(TOLERANTA_MAX_LEI, Math.round(TOLERANTA_PE_LINIE_LEI * Math.max(1, nLinii) * 100) / 100)
const rot2 = x => Math.round(x * 100) / 100
const lei = x => `${rot2(x)} lei`

// ── tipul rândului (o singură definiție: situație, deviz AA, teste, ecran) ──
const textNorm = s => norm(s).replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
const RE_OS = /organizare\s+(?:de\s+)?santier|^o\s?s$/
const RE_DIVERSE = /\bdiverse\b|neprevazut/
/** 'os' / 'diverse' / 'articol' din denumire + cod */
export function tipRand(denumire, cod) {
  const d = textNorm(denumire), c = textNorm(cod)
  if (RE_OS.test(d) || RE_OS.test(c)) return 'os'
  if (RE_DIVERSE.test(d) || RE_DIVERSE.test(c)) return 'diverse'
  return 'articol'
}

// ── regexurile formatului F3 (toate ancorate ^…$, L13; test pozitiv + negativ pentru fiecare în parsareSituatie.test.js) ──
// Marcajele de antet („Obiectivul:”, „Obiectul:”, „Situatie de plata”, „Deviz”) sunt cu majusculă la început și litere mici — așa le tipărește
// programul de devize; textul articolelor e cu MAJUSCULE, deci un paragraf de denumire „DEVIZ …” nu e luat drept antet (fără flag i).
const NUM = '-?\\d+\\.\\d+'
/** zgomot de paginare: „BJ0503 pag 2”, „=====”, „= NR. SIMBOL ART. … =” */
export const RE_PAG = /^\S+\s+pag\s+\d+$/
export const RE_SEP = /^=+$/
export const RE_ANTET_TABEL = /^=\s.*\s=$/
export const RE_OBIECTIV = /^Obiectivul:\s*(.*)$/
/** „Obiectul: 0001 45000000 TRONSON 1” → cod 0001, nume „TRONSON 1” (al doilea număr, dacă există, e codul de clasificare și se sare) */
export const RE_OBIECT = /^Obiectul:\s*(\S+)(?:\s+\d{5,})?\s*(.*)$/
export const RE_SITUATIE = /^Situatie de plata in luna\s+(\d{1,2})\s+anul\s+(\d{4})$/
/** „Deviz BJ0103 4.1.1/1 Firul conductei” / „Deviz oferta 0101 CONDUCTA” → cod, nume (capitolul rămâne în nume) */
export const RE_DEVIZ = /^Deviz(?:\s+oferta)?\s+(\S+)\s*(.*)$/
export const RE_CATEGORIA = /^Categoria de lucrari\b/i
export const RE_PRETURI = /^Preturi de contractare\b/i
/** linia de ARTICOL: nr (3 cifre), simbol, [ fază ] opțional, UM (opțional „100” / „1000” + token cu litere), cantitate (3 zecimale), PU mat, VAL mat */
export const RE_ART = new RegExp(`^(\\d{3})\\s+(\\S+)\\s+(?:\\[\\s*\\d+\\s*\\]\\s+)?((?:1000|100)?\\s*[A-Z][A-Z0-9.]{0,9})\\s+(-?\\d+\\.\\d{3})\\s+(${NUM})\\s+(${NUM})$`)
/** paragraf care ARATĂ a început de articol (3 cifre + simbol + … + trei numere la final), oricare ar fi UM-ul / forma — dacă nu e consumat
 *  de RE_ART e problemă, nu paragraf sărit tăcut */
export const RE_ART_INCEPUT = new RegExp(`^\\d{3}\\s+\\S+\\s+\\S.*\\s${NUM}\\s+${NUM}\\s+${NUM}$`)
/** „0.001 0 Total= 6697.50” / „Total= -50.00” / „suprapunere 50% Total= 5703.69” (ultimul rând de denumire lipit de Total=; grupa 1 = prefixul) */
export const RE_TOTAL_ART = /^(?:(.*)\s)?Total=\s*(-?\d[\d ]*\.\d+)$/
/** paragrafele de denumire poartă la final PU + VAL (două numere) — se taie pentru denumire (și un paragraf format doar din numere, „0.00 0.00”) */
const RE_NUMERE_FINAL = /(?:^|\s+)-?\d+\.\d+(?:\s+-?\d+\.\d+)*$/
/** rândul „gr/UA gr.tot” rămas singur („0.015 0”) când „Total=” s-a lipit de ultimul rând de denumire — zgomot al articolului tocmai închis */
export const RE_GREUTATE = /^\d+\.\d{3}\s+\d+$/
/** rândul de sporuri al articolului („** SPORURI ** MAT.: 100.0% MAN.: 100.0% UTI.: 100.0%”) — informativ, nu conținut */
export const RE_SPORURI = /^\*\*\s*SPORURI\s*\*\*/
export const RE_CHELT_DIRECTE = /^Cheltuieli directe din articole:?$/i
export const RE_CONTROL_ANTET = /^GREUTATE\s+MATERIALE\s+MANOPERA\s+UTILAJ\s+TRANSPORT\s+TOTAL$/i
/** rândul cu cifrele controlului: 6 numere; ultimul = TOTAL = suma „Total=” ale articolelor */
export const RE_CONTROL_NUMERE = new RegExp(`^${NUM}(?:\\s+${NUM}){5}$`)
export const RE_TOTAL_GENERAL = /^TOTAL GENERAL DEVIZ:\s*(-?\d[\d ]*\.\d+)$/

export const MOTIV_FORMAT_F3 = 'format nerecunoscut: situațiile de plată Transgaz se încarcă ca F3 .docx (paragrafe „Deviz …”, articole cu „Total=”, „Cheltuieli directe din articole”, „TOTAL GENERAL DEVIZ”)'
const DENUMIRE_MAX = 300
const numar = s => parseNumar(s)

/**
 * parseSituatieF3(arrayBuffer) → { antet: { luna, an }, obiectiv, devize: [{ obiect_cod, obiect_nume, deviz_cod, deviz_nume, luna, an,
 *   paragraf, linii, suma_articole, control_cheltuieli_directe, total_general, reconciliat, diferenta, toleranta }], linii (toate, aplatizate,
 *   cu obiect / deviz / paragraf), total_citit, total_control, total_document, complet, probleme, avertismente, ignorate, paragrafe }
 * Fără niciun deviz recunoscut → Error(MOTIV_FORMAT_F3 …) (L18: eroare, nu rezultat gol).
 */
export async function parseSituatieF3(arrayBuffer) {
  const JSZip = (await import('jszip')).default
  let zip
  try { zip = await JSZip.loadAsync(arrayBuffer) } catch (e) { throw new Error(`${MOTIV_FORMAT_F3}; fișierul nu e un .docx (${e.message})`) }
  const f = zip.file('word/document.xml')
  if (!f) throw new Error(`${MOTIV_FORMAT_F3}; document.xml lipsă din .docx`)
  return situatieDinParagrafe(paragrafeDinDocXml(await f.async('string')))
}

/** Nucleul (paragrafe deja text plat → rezultat); exportat pentru teste și pentru tura de noapte. */
export function situatieDinParagrafe(paras) {
  const devize = [], probleme = [], avertismente = [], ignorate = []
  const problema = (i, motiv, extra) => probleme.push({ paragraf: i + 1, motiv, ...(extra || {}) })
  let obiectiv = null, obiect = null, situatie = null, deviz = null, articol = null
  // stări: inainte (niciun deviz încă) | obiectiv | obiect (antetul: numele pot continua) | deviz (antetul devizului) | articole |
  //        control_antet | control_numere | dupa_control | incheiat (după TOTAL GENERAL)
  let stare = 'inainte'
  const eticheta = d => `devizul „${d.deviz_cod || '?'}”${d.obiect_cod ? ` (obiectul „${d.obiect_cod}”)` : ''}`

  const inchideArticol = motiv => {
    if (!articol) return
    articol.incomplet = motiv
    deviz.linii.push(articol)
    problema(articol.paragraf - 1, `${eticheta(deviz)}: articolul ${articol.nr} „${articol.cod}” ${motiv} — valoarea lipsește din sumă`, { nr: articol.nr, cod: articol.cod })
    articol = null
  }
  const inchideDeviz = () => {
    if (!deviz) return
    if (articol) inchideArticol('fără „Total=” până la sfârșitul devizului')
    const cuValoare = deviz.linii.filter(l => l.valoare != null)
    deviz.suma_articole = rot2(cuValoare.reduce((s, l) => s + l.valoare, 0))
    deviz.toleranta = toleranta(cuValoare.length)
    const c = deviz.control_cheltuieli_directe
    deviz.diferenta = c == null ? null : rot2(c - deviz.suma_articole)
    deviz.reconciliat = c != null && Math.abs(deviz.diferenta) <= deviz.toleranta + 1e-9
    const p = deviz.paragraf - 1
    if (deviz.linii.length === 0) problema(p, `${eticheta(deviz)}: niciun articol citit`)
    if (c == null) problema(p, `${eticheta(deviz)}: controlul „Cheltuieli directe din articole … TOTAL” nu a fost găsit — suma articolelor (${lei(deviz.suma_articole)}) nu poate fi verificată`)
    else if (!deviz.reconciliat) problema(p, `${eticheta(deviz)}: suma „Total=” ale articolelor citite (${lei(deviz.suma_articole)}, ${cuValoare.length} articole) ≠ controlul „Cheltuieli directe din articole” (${lei(c)}) — diferență ${lei(deviz.diferenta)}, toleranță ${lei(deviz.toleranta)}: un articol lipsește, e în plus sau e citit greșit`, { diferenta: deviz.diferenta })
    if (deviz.total_general == null) problema(p, `${eticheta(deviz)}: „TOTAL GENERAL DEVIZ” nu a fost găsit`)
    devize.push(deviz)
    deviz = null
  }
  const devizNou = (i, cod, nume) => {
    inchideDeviz()
    deviz = {
      obiect_cod: obiect?.cod || '', obiect_nume: obiect?.nume || '', deviz_cod: cod, deviz_nume: nume,
      luna: situatie?.luna ?? null, an: situatie?.an ?? null, paragraf: i + 1,
      linii: [], suma_articole: 0, control_cheltuieli_directe: null, total_general: null, reconciliat: false, diferenta: null, toleranta: null,
    }
  }
  const articolNou = (i, m) => {
    if (articol) inchideArticol('fără „Total=” până la articolul următor')
    const q = numar(m[4])
    articol = {
      obiect_cod: deviz.obiect_cod, obiect_nume: deviz.obiect_nume, deviz_cod: deviz.deviz_cod, deviz_nume: deviz.deviz_nume,
      nr: m[1], cod: m[2], denumire: '', um: m[3].replace(/\s+/g, ' ').trim(), cantitate: Number.isFinite(q) ? q : null, valoare: null, tip_rand: 'articol', paragraf: i + 1,
    }
    if (!Number.isFinite(q)) problema(i, `${eticheta(deviz)}: cantitatea articolului ${m[1]} „${m[2]}” nu e număr („${m[4]}”)`, { nr: m[1], cod: m[2] })
  }
  const controlCitit = p => { deviz.control_cheltuieli_directe = numar(p.split(/\s+/).pop()); stare = 'dupa_control' }

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim()
    if (!p) continue
    let m
    // zgomot de paginare / antetul tabelului / rândurile de categorie și prețuri: sărite în orice stare (în antetul devizului închid antetul)
    if (RE_PAG.test(p) || RE_SEP.test(p) || RE_ANTET_TABEL.test(p) || RE_CATEGORIA.test(p) || RE_PRETURI.test(p)) { if (stare === 'deviz') stare = 'articole'; continue }
    // marcajele de antet, în orice stare (un deviz deschis se închide, cu problemele lui)
    if ((m = p.match(RE_OBIECTIV))) { inchideDeviz(); obiectiv = { nume: m[1].trim() }; obiect = null; stare = 'obiectiv'; continue }
    if ((m = p.match(RE_OBIECT))) { inchideDeviz(); obiect = { cod: m[1], nume: m[2].trim() }; stare = 'obiect'; continue }
    if ((m = p.match(RE_SITUATIE))) { situatie = { luna: Number(m[1]), an: Number(m[2]) }; if (stare === 'obiectiv') stare = 'inainte'; continue }
    if ((m = p.match(RE_DEVIZ))) { devizNou(i, m[1], m[2].trim()); stare = 'deviz'; continue }
    // continuarea numelor din antet (paragrafele următoare, până la marcajul următor) — niciodată o linie care arată a articol
    const arataArticol = RE_ART_INCEPUT.test(p)
    if (stare === 'obiectiv' && obiectiv && !arataArticol) { obiectiv.nume = `${obiectiv.nume} ${p}`.trim(); continue }
    if (stare === 'obiect' && obiect && !arataArticol) { obiect.nume = `${obiect.nume} ${p}`.trim(); continue }
    if (stare === 'deviz' && !arataArticol) { deviz.deviz_nume = `${deviz.deviz_nume} ${p}`.trim(); continue }
    if (stare === 'deviz') stare = 'articole'

    if (stare === 'articole') {
      if ((m = p.match(RE_ART))) { articolNou(i, m); continue }
      if (arataArticol) { problema(i, `${eticheta(deviz)}: paragraf care arată a început de articol, dar nu are forma F3 așteptată (nr + simbol + UM + cantitate cu 3 zecimale + două prețuri) — neconsumat: „${p.slice(0, 80)}”`); continue }
      if ((m = p.match(RE_TOTAL_ART))) {
        if (!articol) { problema(i, `${eticheta(deviz)}: „Total=” fără linie de articol înaintea lui — valoarea ${m[2].trim()} nu e a niciunui articol citit`); continue }
        const v = numar(m[2])
        if (!Number.isFinite(v)) { inchideArticol(`cu „Total=” care nu e număr („${m[2].trim()}”)`); continue }
        articol.valoare = v
        // prefixul cu litere („suprapunere 50%”) = ultimul rând de denumire lipit de „Total=”; prefixul numeric („0.001 0”) = greutățile
        const prefix = (m[1] || '').replace(RE_NUMERE_FINAL, '').trim()
        if (/[A-Za-z]/.test(prefix)) articol.denumire = `${articol.denumire} ${prefix}`.trim()
        articol.denumire = articol.denumire.slice(0, DENUMIRE_MAX).trim()
        articol.tip_rand = tipRand(articol.denumire, articol.cod)
        deviz.linii.push(articol); articol = null
        continue
      }
      if (RE_CHELT_DIRECTE.test(p)) { if (articol) inchideArticol('fără „Total=” până la „Cheltuieli directe din articole”'); stare = 'control_antet'; continue }
      if ((m = p.match(RE_TOTAL_GENERAL))) { if (articol) inchideArticol('fără „Total=” până la „TOTAL GENERAL DEVIZ”'); deviz.total_general = numar(m[1]); inchideDeviz(); stare = 'incheiat'; continue }
      if (articol) { const t = p.replace(RE_NUMERE_FINAL, '').trim(); if (t) articol.denumire = `${articol.denumire} ${t}`.trim(); continue }
      if (RE_GREUTATE.test(p) || RE_SPORURI.test(p)) continue // rândurile informative ale articolului tocmai închis
      ignorate.push({ paragraf: i + 1, deviz_cod: deviz.deviz_cod, text: p.slice(0, 120) })
      continue
    }
    if (stare === 'control_antet') {
      if (RE_CONTROL_ANTET.test(p)) { stare = 'control_numere'; continue }
      if (RE_CONTROL_NUMERE.test(p)) { controlCitit(p); continue }
      problema(i, `${eticheta(deviz)}: după „Cheltuieli directe din articole” nu urmează rândul GREUTATE … TOTAL, ci „${p.slice(0, 80)}” — controlul lipsește`); stare = 'dupa_control'
      // paragraful curent se verifică mai jos ca articol / total în afara zonei de articole
    } else if (stare === 'control_numere') {
      if (RE_CONTROL_NUMERE.test(p)) { controlCitit(p); continue }
      problema(i, `${eticheta(deviz)}: după rândul GREUTATE … TOTAL nu urmează cele 6 cifre ale controlului, ci „${p.slice(0, 80)}” — controlul lipsește`); stare = 'dupa_control'
    }
    // dupa_control / incheiat / inainte / antet fără deviz: TOTAL GENERAL închide devizul; un articol sau un „Total=” aici n-ar intra în
    // niciun deviz → problemă (fail-safe), nu tăcere; restul (CAM, indirecte, profit, TVA, semnături) e cunoscut și se sare
    if (stare === 'dupa_control' && (m = p.match(RE_TOTAL_GENERAL))) { deviz.total_general = numar(m[1]); inchideDeviz(); stare = 'incheiat'; continue }
    const unde = deviz ? `după controlul ${eticheta(deviz)}` : devize.length ? `în afara devizelor (după ${eticheta(devize[devize.length - 1])})` : 'înaintea primului deviz'
    if (arataArticol) problema(i, `linie de articol ${unde} — nu intră în niciun deviz: „${p.slice(0, 80)}”`)
    else if (RE_TOTAL_ART.test(p)) problema(i, `„Total=” ${unde} — nu intră în niciun deviz: „${p.slice(0, 80)}”`)
  }
  inchideDeviz()
  if (devize.length === 0) throw new Error(`${MOTIV_FORMAT_F3}; niciun paragraf „Deviz …” în ${paras.length} paragrafe${probleme.length ? ` (${probleme.length} probleme; prima: ${probleme[0].motiv})` : ''}`)

  // antetul fișierului: doar valorile pe care TOATE devizele le dau la fel (identitatea situației nu o decide primul deviz și nici
  // majoritatea: pe situațiile reale un singur deviz din 17 avea altă lună / alt an, iar omul decide care e corect). Avertismentul
  // grupează devizele pe valoare (cele mai multe întâi; un grup de peste 3 devize apare ca număr) și dă grupurile întregi în `valori`.
  const antet = { luna: null, an: null }
  for (const k of ['luna', 'an']) {
    const valori = [...new Set(devize.map(d => d[k]).filter(v => v != null))]
    if (valori.length === 1) antet[k] = valori[0]
    else if (valori.length > 1) {
      const grupuri = valori.map(v => ({ valoare: v, devize: devize.filter(d => d[k] === v).map(d => d.deviz_cod) })).sort((a, b) => b.devize.length - a.devize.length)
      const fara = devize.filter(d => d[k] == null).map(d => d.deviz_cod)
      const text = grupuri.map(g => `${g.valoare} (${g.devize.length > 3 ? `${g.devize.length} devize` : g.devize.join(', ')})`).join('; ')
      avertismente.push({ camp: k, valori: grupuri, motiv: `devizele dau valori diferite pentru ${k === 'luna' ? 'lună' : 'an'}: ${text}${fara.length ? `; fără valoare: ${fara.join(', ')}` : ''} — câmpul rămâne de completat de om` })
    } else avertismente.push({ camp: k, motiv: `niciun deviz nu are „Situatie de plata in luna L anul A” — ${k === 'luna' ? 'luna' : 'anul'} rămâne de completat de om` })
  }
  const linii = devize.flatMap(d => d.linii)
  const cuControl = devize.filter(d => d.control_cheltuieli_directe != null), cuTotal = devize.filter(d => d.total_general != null)
  return {
    antet, obiectiv: obiectiv ? obiectiv.nume : null, devize, linii,
    total_citit: rot2(devize.reduce((s, d) => s + d.suma_articole, 0)),
    total_control: cuControl.length === devize.length ? rot2(cuControl.reduce((s, d) => s + d.control_cheltuieli_directe, 0)) : null,
    total_document: cuTotal.length === devize.length ? rot2(cuTotal.reduce((s, d) => s + d.total_general, 0)) : null,
    complet: probleme.length === 0, probleme, avertismente, ignorate, paragrafe: paras.length,
  }
}

const RE_EXT_EXCEL = /\.(xlsx?|xlsm|xlsb|csv)$/i
/** refuzul clar pentru alt format decât F3 .docx (nu ghicim) */
const refuz = nume => new Error(`${MOTIV_FORMAT_F3}; fișierul „${nume || 'fără nume'}” ${RE_EXT_EXCEL.test(nume || '') ? 'e un registru Excel (borderoul / centralizatorul / extrasele nu sunt detaliul pe articole)' : 'nu e .docx'}`)
/** Situațiile Transgaz nu vin în Excel: refuz explicit (păstrat cu numele vechi, ca ecranul să poată afișa motivul). */
export async function parseSituatieExcel() { throw refuz('registru.xlsx') }
/** Situația de plată dintr-un File (browser) / { name, arrayBuffer() }: .docx → F3; orice altceva → refuz clar. */
export async function parseSituatie(file) {
  const nume = file?.name || ''
  if (!/\.docx$/i.test(nume)) throw refuz(nume)
  return parseSituatieF3(await file.arrayBuffer())
}
/**
 * Devizul unui act adițional / NR / NCS: ACELAȘI format F3 DOCX și același control pe deviz (parseSituatieF3); în plus `negative` =
 * câte linii au cantitatea negativă (diminuările din NR / AA se adună cu semn în BD). Alt format = refuz clar.
 */
export async function parseDevizModificare(file) {
  const rez = await parseSituatie(file)
  return { ...rez, negative: rez.linii.filter(l => l.cantitate != null && l.cantitate < 0).length }
}
