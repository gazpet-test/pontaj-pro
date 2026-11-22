// ═══════════════════════════════════════════════════════════════════════════
// restDecontat/parsareSituatie.js — parsarea DETERMINISTĂ (fără AI, fără BD) a situației de lucrări detaliate (XLS/XLSX,
// modelul Transgaz: cantitate în perioadă / luna curentă, cumulat, preț unitar, valoare; rândul OS; „diverse”) și a devizului
// unui act adițional / NR / NCS (prin parseDeviz, cu semnul cantităților păstrat). Rulează în browser și în Node (teste,
// tura de noapte — Task 6 folosește ACELAȘI modul).
//
// Contract (plan Task 3): parseSituatieExcel(arrayBuffer) -> { antet: {nr_situatie, luna, an}, linii: [{obiect_cod, deviz_cod, nr,
//   cod, denumire, um, cantitate_perioada, cantitate_cumulat_doc, pret_unitar, valoare, tip_rand}], total }.
// În plus (L12 — nimic nu dispare tăcut): total_doc (totalul tipărit, dacă există), diferenta_total, foi, coloane (ce coloană s-a
//   luat pentru ce), fara_miscare (rânduri fără cantitate și fără valoare în perioadă), ignorate (rânduri de text / titlu),
//   probleme (rânduri cu cifre care NU au putut deveni linii), avertismente (linii păstrate, dar de privit: valoare ≠ cantitate × preț).
// Fiecare linie poartă și `foaie` + `rand` (rândul Excel, de la 1) pentru trasabilitate; spre RPC se trimit DOAR CAMPURI_LINIE_RPC.
// Alt format (fără antetele de mai sus) = eroare „format nerecunoscut …” cu ce s-a găsit și ce lipsește, NU linii goale (L12, L18).
// Numerele: parseNumar (helper EXISTENT, L17): RO / EN, text nenumeric = NaN → problemă, nu 0; semnul negativ se păstrează
// (regularizări). Cantitățile NU se convertesc aici (UM-ul brut rămâne pe linie; conversia / compararea = potrivire.js + BD).
// ═══════════════════════════════════════════════════════════════════════════
import { parseNumar } from '../izoDocumenteLogica.js'
import { norm } from '../lib/diacritice.js'
import { parseDeviz } from '../devizParser.js'

/** Câmpurile unei linii acceptate de fn_rest_decontat_confirma_situatie (plus cheie / potrivire, puse de ecran după confirmare). */
export const CAMPURI_LINIE_RPC = ['obiect_cod', 'deviz_cod', 'nr', 'cod', 'denumire', 'um', 'cantitate_perioada', 'cantitate_cumulat_doc', 'pret_unitar', 'valoare', 'tip_rand']
export const COLOANE_OBLIGATORII = ['denumire', 'um', 'cantitate_perioada', 'pret_unitar', 'valoare']
const RANDURI_CAUTARE_ANTET = 80
const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

/** text de antet normalizat: fără diacritice, litere mici, punctele și spațiile multiple → un spațiu */
export const textAntet = s => norm(s).replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
const text = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())
const tokeni = s => textAntet(s).split(/[^a-z0-9]+/).filter(Boolean)
const rot = (x, z = 2) => Math.round(x * 10 ** z) / 10 ** z
const eNumeric = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^-?\d+([.,]\d+)*$/.test(v.trim()))

// „2.000” / „12,345”: un singur fel de separator, doar grupuri de exact 3 cifre după el → poate fi mii sau zecimale; parseNumar l-ar citi
// ca zecimale — îl declarăm ambiguu (L17). Celulele NUMERICE ale Excel-ului nu trec pe aici (vin ca număr).
export const RE_NUMAR_AMBIGUU = /^-?\d{1,3}(?:(?:\.\d{3})+|(?:,\d{3})+)$/
const RE_CUMUL = /cumul|de la inceput|la zi|pana la data|pana in prezent|precedent/
const RE_CONTRACT = /contract|ofert|deviz|prevazut|aprobat|initial/
const RE_PERIOADA = /perioad|lun[aă]|lunar|curent|realizat|executat|decontat|aceasta situati|situatia curenta/
const RE_CALIFICATIV = /perioad|luna|lunar|curent|cumul|contract|ofert|realizat|executat|decontat|total|unitar|lei|ron|precedent|prezent/

/**
 * Clasa unei coloane din textul (concatenat) al antetului ei: 'nr' | 'cod' | 'denumire' | 'um' | 'cantitate_contract' |
 * 'cantitate_perioada' | 'cantitate_cumulat' | 'cantitate' (fără calificativ) | 'pret_unitar' | 'valoare' | 'valoare_cumulat' |
 * 'valoare_contract' | null. Ordinea contează: valoare → preț → cantitate (un antet „Valoare (cantitate × preț)” e valoare).
 */
export function clasificaColoana(textColoana) {
  const t = textAntet(textColoana)
  if (!t) return null
  const tok = new Set(tokeni(t))
  const cumul = RE_CUMUL.test(t), contract = RE_CONTRACT.test(t), perioada = RE_PERIOADA.test(t)
  if (/valoar/.test(t) || tok.has('val')) return contract && !perioada && !cumul ? 'valoare_contract' : cumul ? 'valoare_cumulat' : 'valoare'
  if (/pret/.test(t) || tok.has('pu') || tok.has('p')) return 'pret_unitar'
  if (/cantit/.test(t) || tok.has('cant')) {
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

// rând „index de coloane” (0 1 2 3 … sau 1 2 3 …): doar întregi, cel puțin două, crescători cu 1
function eRandIndex(row) {
  const v = row.map(c => (c === '' || c == null ? null : c)).filter(c => c != null)
  if (v.length < 2) return false
  const n = v.map(c => (typeof c === 'number' ? c : /^\d+$/.test(String(c).trim()) ? Number(c) : NaN))
  return n.every((x, i) => Number.isInteger(x) && (i === 0 || x === n[i - 1] + 1))
}
const eRandDate = row => !eRandIndex(row) && row.some(c => c !== '' && c != null && eNumeric(c))
const eRandGol = row => row.every(c => c === '' || c == null)
// rândul de sub antetul-frunză care aduce doar calificative („perioadă”, „cumulat”, „contract”…)
const eRandCalificativ = row => !eRandGol(row) && !eRandDate(row) && row.every(c => c === '' || c == null || RE_CALIFICATIV.test(textAntet(c)) || clasificaColoana(c) != null)
// rândul de deasupra antetului-frunză care e grup de antet: fiecare celulă nevidă e o clasă cunoscută sau un calificativ ȘI cel puțin
// una e o coloană de tabel propriu-zisă (nu doar „nr” — un titlu „Situație nr. 7” n-are ce căuta în antet, el dă antetul documentului)
const CLASE_TABEL = new Set(['cod', 'denumire', 'um', 'pret_unitar', 'cantitate', 'cantitate_perioada', 'cantitate_cumulat', 'cantitate_contract', 'valoare', 'valoare_cumulat', 'valoare_contract'])
const eRandGrup = row => !eRandGol(row) && !eRandDate(row) && row.every(c => c === '' || c == null || clasificaColoana(c) != null || RE_CALIFICATIV.test(textAntet(c)))
  && row.some(c => CLASE_TABEL.has(clasificaColoana(c)))
const familie = cls => (cls && cls.startsWith('cantitate') ? 'cantitate' : cls && cls.startsWith('valoare') ? 'valoare' : cls)

/**
 * Găsește blocul de antet al unei foi (rânduri 0-based [inceput, sfarsit], inclusiv) și coloanele pe clase.
 * rows = sheet_to_json(header:1, blankrows:true, defval:''); merges = sheet['!merges'] (celulele unite primesc valoarea din stânga-sus).
 * Întoarce { ok: true, inceput, sfarsit, primulRandDate, coloane } sau { ok: false, cel_mai_bun: {rand, gasite, lipsesc} | null }.
 */
export function recunoasteAntet(rows, merges = []) {
  const uniri = new Map()
  for (const m of merges || []) {
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) uniri.set(`${r},${c}`, [m.s.r, m.s.c])
  }
  const cel = (r, c) => {
    const u = uniri.get(`${r},${c}`)
    const v = u ? rows[u[0]]?.[u[1]] : rows[r]?.[c]
    return v == null ? '' : v
  }
  const latime = Math.max(0, ...rows.slice(0, RANDURI_CAUTARE_ANTET + 3).map(r => r.length))
  const randAntet = r => Array.from({ length: latime }, (_, c) => cel(r, c))
  let celMaiBun = null
  for (let r = 0; r < Math.min(rows.length, RANDURI_CAUTARE_ANTET); r++) {
    const frunza = randAntet(r)
    if (eRandGol(frunza) || eRandDate(frunza)) continue
    const familii = new Set(frunza.map(c => familie(clasificaColoana(c))).filter(Boolean))
    if (familii.size < 3) continue
    // blocul: până la 2 rânduri de grup deasupra + până la 2 rânduri de calificative dedesubt
    let inceput = r, sfarsit = r
    for (let k = 1; k <= 2 && r - k >= 0; k++) { if (eRandGrup(randAntet(r - k))) inceput = r - k; else break }
    for (let k = 1; k <= 2 && r + k < rows.length; k++) { if (eRandCalificativ(randAntet(r + k))) sfarsit = r + k; else break }
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
    const una = k => (peClase.get(k) || []).length === 1 ? peClase.get(k)[0] : -1
    const coloane = { nr: una('nr'), cod: una('cod'), denumire: una('denumire'), um: una('um'), pret_unitar: una('pret_unitar'), cantitate_perioada: -1, cantitate_cumulat: una('cantitate_cumulat'), valoare: -1 }
    const ambigue = []
    for (const k of ['denumire', 'um', 'pret_unitar', 'cantitate_perioada', 'cantitate_cumulat', 'valoare']) if ((peClase.get(k) || []).length > 1) ambigue.push(k)
    // cantitate în perioadă: explicită; altfel „Cantitate” simplă DOAR dacă există o coloană de cumulat (atunci cea simplă e perioada)
    if ((peClase.get('cantitate_perioada') || []).length === 1) coloane.cantitate_perioada = peClase.get('cantitate_perioada')[0]
    else if (!peClase.has('cantitate_perioada') && (peClase.get('cantitate') || []).length === 1 && coloane.cantitate_cumulat >= 0) coloane.cantitate_perioada = peClase.get('cantitate')[0]
    if ((peClase.get('valoare') || []).length === 1) coloane.valoare = peClase.get('valoare')[0]
    const gasite = Object.keys(coloane).filter(k => coloane[k] >= 0)
    const lipsesc = COLOANE_OBLIGATORII.filter(k => coloane[k] < 0)
    if (lipsesc.length === 0 && ambigue.length === 0) {
      let primulRandDate = sfarsit + 1
      while (primulRandDate < rows.length && (eRandIndex(rows[primulRandDate]) || eRandGol(rows[primulRandDate]))) primulRandDate++
      return { ok: true, inceput, sfarsit, primulRandDate, coloane, texteColoane }
    }
    if (!celMaiBun || gasite.length > celMaiBun.gasite.length) celMaiBun = { rand: r + 1, gasite, lipsesc, ambigue }
  }
  return { ok: false, cel_mai_bun: celMaiBun }
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

const RE_OBIECT = /^obiect(?:ul)?\s*[:.\-]?\s*([a-z0-9][a-z0-9./-]*)\s*[:.\-]?\s*(.*)$/
const RE_DEVIZ = /^deviz(?:ul)?(?:\s+(?:oferta|ofertă))?\s*[:.\-]?\s*([a-z0-9][a-z0-9./-]*)\s*[:.\-]?\s*(.*)$/
const RE_TOTAL = /^total\b/
const RE_OS = /organizare\s+(?:de\s+)?santier|^o\s?s$/
const RE_DIVERSE = /\bdiverse\b|neprevazut/

/** tipul rândului din denumire + cod: 'os' / 'diverse' / 'articol' (o singură definiție, folosită și de teste) */
export function tipRand(denumire, cod) {
  const d = textAntet(denumire), c = textAntet(cod)
  if (RE_OS.test(d) || RE_OS.test(c)) return 'os'
  if (RE_DIVERSE.test(d) || RE_DIVERSE.test(c)) return 'diverse'
  return 'articol'
}

function liniiDinFoaie(nume, rows, merges) {
  const a = recunoasteAntet(rows, merges)
  if (!a.ok) return { ok: false, cel_mai_bun: a.cel_mai_bun }
  const c = a.coloane
  const titluri = rows.slice(0, a.inceput).map(r => r.map(text).filter(Boolean).join(' ')).filter(Boolean)
  const linii = [], ignorate = [], probleme = [], avertismente = [], sectiuni = []
  let fara_miscare = 0, total_doc = null, obiect = { cod: '', nume: '' }, deviz = { cod: '', nume: '' }
  const nrCel = r => (c.nr >= 0 ? text(rows[r][c.nr]) : '')
  for (let r = a.primulRandDate; r < rows.length; r++) {
    const row = rows[r]
    if (!row || eRandGol(row)) continue
    const rand = r + 1
    const den = text(row[c.denumire]), cod = c.cod >= 0 ? text(row[c.cod]) : '', um = text(row[c.um])
    const brut = { q: row[c.cantitate_perioada], qc: c.cantitate_cumulat >= 0 ? row[c.cantitate_cumulat] : '', p: row[c.pret_unitar], v: row[c.valoare] }
    const q = parseNumar(brut.q), qc = parseNumar(brut.qc), p = parseNumar(brut.p), v = parseNumar(brut.v)
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
    if ((s = sectiune(RE_OBIECT))) { obiect = s; deviz = { cod: '', nume: '' }; sectiuni.push({ rand, tip: 'obiect', ...s }); continue }
    if ((s = sectiune(RE_DEVIZ))) { deviz = s; sectiuni.push({ rand, tip: 'deviz', ...s }); continue }
    if (RE_TOTAL.test(dn) || RE_TOTAL.test(cn) || RE_TOTAL.test(nrn)) {
      if (v != null && Number.isFinite(v)) total_doc = v
      else if (v != null) probleme.push({ foaie: nume, rand, motiv: 'totalul tipărit nu e număr', text: text(brut.v) })
      continue
    }
    if (!areCifre && !um) { ignorate.push({ foaie: nume, rand, text: [nrCel(r), cod, den].filter(Boolean).join(' ') }); continue }
    if (!den && !cod) { probleme.push({ foaie: nume, rand, motiv: 'rând cu cifre, fără denumire și fără cod' }); continue }
    const nan = Object.entries({ cantitate_perioada: q, cantitate_cumulat_doc: qc, pret_unitar: p, valoare: v }).filter(([, x]) => Number.isNaN(x))
    if (nan.length) { probleme.push({ foaie: nume, rand, motiv: `număr neinterpretabil: ${nan.map(([k]) => k).join(', ')}`, cod, denumire: den }); continue }
    // text cu UN singur fel de separator și grupuri exacte de 3 cifre („2.000”, „12,345”): mii sau zecimale? — nu ghicim (L17)
    const ambigue = Object.entries({ cantitate_perioada: brut.q, cantitate_cumulat_doc: brut.qc, pret_unitar: brut.p, valoare: brut.v })
      .filter(([, x]) => typeof x === 'string' && RE_NUMAR_AMBIGUU.test(x.trim()))
    if (ambigue.length) { probleme.push({ foaie: nume, rand, motiv: `număr ambiguu (mii sau zecimale?): ${ambigue.map(([k, x]) => `${k} „${x.trim()}”`).join(', ')}`, cod, denumire: den }); continue }
    if (q == null && v == null) { fara_miscare++; continue }
    if (!um) { probleme.push({ foaie: nume, rand, motiv: 'UM lipsă', cod, denumire: den }); continue }
    const tip = tipRand(den, cod)
    if (v == null) { probleme.push({ foaie: nume, rand, motiv: 'valoare lipsă (cantitate fără valoare)', cod, denumire: den }); continue }
    if (q == null && tip === 'articol') { probleme.push({ foaie: nume, rand, motiv: 'cantitate în perioadă lipsă (valoare fără cantitate)', cod, denumire: den }); continue }
    if (q == null) avertismente.push({ foaie: nume, rand, motiv: `rând ${tip} fără cantitate (valoare forfetară)`, denumire: den })
    if (q != null && p != null && Math.abs(q * p - v) > Math.max(0.05, Math.abs(v) * 0.001)) {
      avertismente.push({ foaie: nume, rand, motiv: 'valoare ≠ cantitate × preț unitar', cod, denumire: den, calculat: rot(q * p), valoare: v })
    }
    linii.push({
      obiect_cod: obiect.cod, deviz_cod: deviz.cod, nr: nrCel(r), cod, denumire: den, um,
      cantitate_perioada: q, cantitate_cumulat_doc: qc, pret_unitar: p, valoare: v, tip_rand: tip,
      foaie: nume, rand, obiect_nume: obiect.nume, deviz_nume: deviz.nume,
    })
  }
  return { ok: true, titluri, linii, ignorate, probleme, avertismente, sectiuni, fara_miscare, total_doc, coloane: c, antet_rand: a.inceput + 1 }
}

/**
 * Situația de lucrări detaliată din XLS/XLSX (modelul Transgaz). Toate foile cu antet recunoscut se citesc (o foaie pe obiect e
 * un caz comun); >1 foaie = avertisment (de verificat că nu e și un centralizator). Fără antet recunoscut nicăieri → Error
 * „format nerecunoscut …”; antet recunoscut dar nicio linie → Error (o situație goală nu intră tăcut).
 */
export async function parseSituatieExcel(arrayBuffer) {
  const _x = await import('xlsx-js-style')
  const XLSX = _x.default?.read ? _x.default : _x
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const foi = [], candidati = []
  let linii = [], ignorate = [], probleme = [], avertismente = [], sectiuni = [], titluri = [], coloane = {}
  let fara_miscare = 0, total_doc = null, cuTotal = 0
  for (const nume of wb.SheetNames) {
    const sheet = wb.Sheets[nume]
    if (!sheet || !sheet['!ref']) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: '' })
    const f = liniiDinFoaie(nume, rows, sheet['!merges'] || [])
    if (!f.ok) { if (f.cel_mai_bun) candidati.push({ foaie: nume, ...f.cel_mai_bun }); continue }
    foi.push(nume)
    coloane[nume] = f.coloane
    titluri = titluri.concat(f.titluri)
    linii = linii.concat(f.linii); ignorate = ignorate.concat(f.ignorate); probleme = probleme.concat(f.probleme)
    avertismente = avertismente.concat(f.avertismente); sectiuni = sectiuni.concat(f.sectiuni); fara_miscare += f.fara_miscare
    if (f.total_doc != null) { total_doc = (total_doc ?? 0) + f.total_doc; cuTotal++ }
  }
  if (foi.length === 0) {
    const cel = candidati.sort((a, b) => b.gasite.length - a.gasite.length)[0]
    const detaliu = cel
      ? ` Cel mai apropiat: foaia „${cel.foaie}”, rândul ${cel.rand}: găsite [${cel.gasite.join(', ')}], lipsesc [${cel.lipsesc.join(', ')}]${cel.ambigue?.length ? `, ambigue [${cel.ambigue.join(', ')}]` : ''}.`
      : ' Nicio foaie nu are un rând de antet cu Denumire / UM / Cantitate / Preț / Valoare.'
    throw new Error(`format nerecunoscut: nu am găsit antetele modelului Transgaz (cantitate în perioadă, preț unitar, valoare, UM, denumire).${detaliu}`)
  }
  if (linii.length === 0) {
    throw new Error(`situația nu are nicio linie de articol (foile ${foi.join(', ')}; rânduri fără mișcare: ${fara_miscare}, probleme: ${probleme.length})`)
  }
  if (foi.length > 1) avertismente.push({ motiv: `${foi.length} foi cu antet recunoscut (${foi.join(', ')}) — verifică să nu fie și un centralizator care dublează liniile` })
  if (cuTotal > 0 && cuTotal < foi.length) avertismente.push({ motiv: `rând TOTAL găsit doar în ${cuTotal} din ${foi.length} foi — totalul tipărit e parțial` })
  const total = rot(linii.reduce((s, l) => s + l.valoare, 0))
  return {
    antet: antetDinTitluri(titluri), linii, total,
    total_doc, diferenta_total: total_doc == null ? null : rot(total - total_doc),
    foi, coloane, sectiuni, fara_miscare, ignorate, probleme, avertismente,
  }
}

/**
 * Devizul unui act adițional / NR / NCS (DOCX sau XLS/XLSX): refolosește parseDeviz (catalogul F3) și PĂSTREAZĂ semnul
 * cantităților (diminuările sunt negative; „doar diferențe” se adună cu semn în BD). Fără articole = eroare, nu listă goală.
 */
export async function parseDevizModificare(file) {
  const arts = await parseDeviz(file)
  if (!Array.isArray(arts) || arts.length === 0) throw new Error(`format nerecunoscut: niciun articol de deviz în „${file?.name || 'fișier'}”`)
  const probleme = []
  const linii = arts.map((a, i) => {
    const q = a.cantitate
    if (q == null || !Number.isFinite(q)) probleme.push({ poz: i + 1, cod: a.cod, denumire: a.denumire, motiv: 'cantitate lipsă sau neinterpretabilă' })
    return { ...a, cantitate: q == null || !Number.isFinite(q) ? null : q }
  })
  return { linii, negative: linii.filter(l => l.cantitate != null && l.cantitate < 0).length, probleme }
}
