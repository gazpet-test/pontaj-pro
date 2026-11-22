// ═══════════════════════════════════════════════════════════════════════════
// devizParser.js — parsează antemăsurătoarea (F3 „Lista cu cantități de lucrări")
// dintr-un deviz românesc și scoate articolele structurate pentru
// proiect_articole. Rulează CLIENT-SIDE (browser) și în Node (test).
//   - .docx: JSZip → word/document.xml → paragrafe → articole
//   - .xls/.xlsx: xlsx-js-style → rânduri → articole (best-effort pe antet)
// Structură articol: {obiect_cod, obiect_nume, deviz_cod, deviz_nume, nr, cod,
//                     denumire, um, cantitate, valoare}
// ═══════════════════════════════════════════════════════════════════════════
// Sub opțiunea explicită { contabilizare: true } (DOAR Rest de decontat, parseDevizModificare) se aplică invariantul de contabilizare
// din restDecontat/contabilizare.js (review #1165 r5); fără opțiune, catalogul rămâne identic cu main.
import { eRandGol, eRandDate, randCandidat, eMetaDocument, eTotalDovedit, tipRand, numar, RE_NUMAR_AMBIGUU, verificaContabilizare, randuriDeLaA1 } from './restDecontat/contabilizare.js'

// Unități de măsură din deviz → (unitate de bază, factor de conversie spre bază).
// ATENȚIE: multe articole de conducte/săpături sunt cotate în unități „×100":
//   HM = hectometru = 100 m  ·  „100 MC"/„100 MP"/„100 M" = ×100.
// Fără conversie, o lansare de 13,910 HM (1.391 m) apărea ca 13,91 m (÷100 greșit),
// pentru că regexul vechi prindea „M" din „HM". Ordinea CONTEAZĂ: variantele
// „100 …" și „HM" trebuie testate ÎNAINTEA celor simple (M).
const UM_DEFS = [
  { re: '100\\s*M\\.?C\\.?', base: 'mc',  f: 100 },
  { re: '100\\s*M\\.?P\\.?', base: 'mp',  f: 100 },
  { re: '100\\s*M\\.?',      base: 'm',   f: 100 },
  { re: 'H\\.?M\\.?',        base: 'm',   f: 100 },
  { re: 'M\\.?C\\.?',        base: 'mc',  f: 1 },
  { re: 'M\\.?P\\.?',        base: 'mp',  f: 1 },
  { re: 'M\\.?L\\.?',        base: 'm',   f: 1 },
  { re: 'BUC\\.?',           base: 'buc', f: 1 },
  { re: 'TONA',              base: 'to',  f: 1 },
  { re: 'KG',                base: 'kg',  f: 1 },
  { re: 'HA',                base: 'ha',  f: 1 },
  { re: 'M\\.?',             base: 'm',   f: 1 },
  // NB: „ORA" e intenționat exclusă — liniile în ore (manoperă NMB…, utilaje AUT…,
  // epuizare apă) sunt resurse, nu articole de lucrări; le-am lăsa în afara catalogului.
]
const UM_ALT = UM_DEFS.map(d => d.re).join('|')
const ART_RE = /^(\d{3})\s+([A-Z]{2,4}\d[A-Z0-9]*)\s+(.*)$/
// Linie care ARATĂ a articol, dar nu respectă ART_RE (poziția nu are exact 3 cifre: „1000 TSD01B1 M 3”, „1 TSA01A1 MC 2”): sub
// { contabilizare: true } e problemă (review #1165 r5 P1-4), nu paragraf sărit tăcut; pe calea catalogului se sare, ca pe main
const ART_LARG_RE = /^\d{1,6}\s+[A-Z]{2,4}\d[A-Z0-9]*\s+\S/
// linia de articol: eventual „[ N ]" (marcaj fază), apoi UNITATE, apoi CANTITATE
const UM_RE = new RegExp('^(?:\\[\\s*\\d+\\s*\\]\\s*)?(' + UM_ALT + ')\\s+([\\d.,]+)')
const TOTAL_RE = /Total=\s*([\d.,]+)/
// Aceleași două, cu SEMN (-?) la cantitate și la „Total=”: DOAR sub opțiunea explicită { cuSemn: true }, cerută de Rest de decontat
// (parseDevizModificare: devizele actelor adiționale / NR au diminuări negative). IMPLICIT (catalogul F3 din CatalogDevizPanel,
// importul ofertei și al actelor adiționale) rămân regexurile de mai sus: o linie cu cantitate negativă NU e articol și se sare,
// exact ca înainte — altfel importul AA din catalog (sign × |cantitate|) ar transforma o diminuare în suplimentare (review #1165 r1 P1).
const UM_RE_SEMN = new RegExp('^(?:\\[\\s*\\d+\\s*\\]\\s*)?(' + UM_ALT + ')\\s+(-?[\\d.,]+)')
const TOTAL_RE_SEMN = /Total=\s*(-?[\d.,]+)/
const OBIECT_RE = /^Obiectul:\s*(\d+)\s+\d+\s+(.*)/
const DEVIZ_RE = /^Deviz oferta\s+(\d+)\s+(.*)/
// Fereastra istorică a catalogului: denumirea și „Total=” se caută în următoarele FERESTRA_DOCX paragrafe de după linia articolului.
// Pe calea implicită rămâne așa (paritate cu main). Sub { cuSemn: true } (DOAR Rest de decontat) „Total=” se caută până la următorul
// articol / „Obiectul:” / „Deviz oferta” / sfârșit, iar lipsa lui NU e `valoare: null` tăcut: articolul e marcat `incomplet` cu motivul
// (review #1165 r3, L12). Fereastra rămâne doar pentru DENUMIRE (text descriptiv, oricum tăiat la 200 de caractere) pe ambele căi.
const FERESTRA_DOCX = 5

// tokenul brut de unitate → definiția (unitate bază + factor). Fallback ×1, marcat `necunoscut`
// (exportat și pentru scripts/materiale_oferta: extrasele C6 normalizează UM-ul cu aceeași regulă).
export function umInfo(token) {
  const up = String(token).toUpperCase().replace(/\s+/g, ' ').trim()
  for (const d of UM_DEFS) if (new RegExp('^(?:' + d.re + ')$').test(up)) return d
  return { base: up.toLowerCase(), f: 1, necunoscut: true }
}

const num = (s) => {
  if (s == null || s === '') return null
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/,/g, ''))
  return isNaN(n) ? null : n
}

// ── Core: din paragrafe (deja text plat) → articole ──
// optiuni.cuSemn (implicit false): cantitatea / „Total=” negative sunt acceptate cu semn; implicit linia negativă se sare (ca pe main).
//   Tot sub cuSemn: „Total=” se caută până la articolul / secțiunea următoare (nu doar în fereastra de 5 paragrafe), iar lipsa lui
//   marchează articolul `incomplet: '<motiv>'` (valoare: null); un „Total=” de după articolul următor NU e luat drept al celui curent.
// optiuni.contabilizare (implicit false): întoarce { articole, probleme } — o linie de articol (ART_RE) fără UM cunoscută + cantitate NU
//   mai e sărită tăcut ca „resursă”: intră în probleme (paragraful, codul, restul liniei); omul decide. La fel o linie care arată a articol
//   dar nu respectă ART_RE (poziție cu alt număr de cifre, ART_LARG_RE — r5 P1-4). Implicit (catalog) ambele se sar, ca pe main.
export function articoleDinParagrafe(paras, { cuSemn = false, contabilizare = false } = {}) {
  const umRe = cuSemn ? UM_RE_SEMN : UM_RE, totalRe = cuSemn ? TOTAL_RE_SEMN : TOTAL_RE
  const arts = [], probleme = []
  let obiect = null, deviz = null
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    let m
    if ((m = p.match(OBIECT_RE))) obiect = { cod: m[1], nume: m[2].trim() }
    if ((m = p.match(DEVIZ_RE))) deviz = { cod: m[1], nume: m[2].trim() }
    const ma = p.match(ART_RE)
    if (!ma) {
      if (contabilizare && ART_LARG_RE.test(p)) probleme.push({ paragraf: i + 1, motiv: `linie care arată a articol, dar poziția nu are 3 cifre (format neacceptat, sărită): „${p.slice(0, 60)}”` })
      continue
    }
    const [, nr, cod, rest] = ma
    const mu = rest.match(umRe)
    if (!mu) { // linie fără UM+cantitate = resursă (material/utilaj), o sărim — sub contabilizare e problemă, nu tăcere
      if (contabilizare) probleme.push({ paragraf: i + 1, nr, cod, motiv: `linie de articol fără UM cunoscută + cantitate (sărită): „${rest.slice(0, 60)}”` })
      continue
    }
    const info = umInfo(mu[1])
    const q = num(mu[2])
    const um = info.base, cantitate = q == null ? null : Math.round(q * info.f * 1000) / 1000
    // denumirea + valoarea (Total=) vin pe următoarele rânduri
    const den = []
    let valoare = null, totalGasit = false
    for (let j = i + 1; j < paras.length; j++) {
      const inFereastra = j < i + 1 + FERESTRA_DOCX
      if (!cuSemn && !inFereastra) break // calea catalogului: fereastra istorică, identic cu main
      // calea cuSemn: la articolul / secțiunea următoare ne oprim — „Total=” al articolului curent nu mai poate veni după ele
      if (cuSemn && (ART_RE.test(paras[j]) || OBIECT_RE.test(paras[j]) || DEVIZ_RE.test(paras[j]))) break
      const mt = paras[j].match(totalRe)
      if (mt) { valoare = num(mt[1]); totalGasit = true; break }
      if (!inFereastra) continue // dincolo de fereastră (doar cuSemn) căutăm numai „Total=”; denumirea rămâne cea din fereastră
      const t = paras[j].replace(/\s+[\d.,]+(\s+[\d.,]+)*$/, '').trim()
      if (/[A-Z]{3,}/.test(t)) den.push(t)
    }
    const art = {
      obiect_cod: obiect?.cod || '', obiect_nume: obiect?.nume || '',
      deviz_cod: deviz?.cod || '', deviz_nume: deviz?.nume || '',
      nr, cod, denumire: den.join(' ').slice(0, 200).trim(), um, cantitate, valoare,
    }
    if (cuSemn && (!totalGasit || valoare == null)) art.incomplet = totalGasit ? 'valoarea de după „Total=” nu e număr' : 'fără „Total=” până la articolul / secțiunea următoare (valoarea lipsește)'
    arts.push(art)
  }
  return contabilizare ? { articole: arts, probleme, contabilizare: {} } : arts
}

// ── .docx: extrage paragrafele din word/document.xml ──
function paragrafeDinDocXml(xml) {
  const paras = []
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g
  let m
  while ((m = pRe.exec(xml))) {
    const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    let tm, txt = ''
    while ((tm = tRe.exec(m[0]))) txt += tm[1]
    txt = txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim()
    if (txt) paras.push(txt)
  }
  return paras
}

export async function parseDevizDocx(arrayBuffer, optiuni) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(arrayBuffer)
  const f = zip.file('word/document.xml')
  if (!f) throw new Error('document.xml lipsă din .docx')
  const xml = await f.async('string')
  return articoleDinParagrafe(paragrafeDinDocXml(xml), optiuni)
}

// ── .xls/.xlsx: best-effort pe antet (Nr, Cod/Simbol, Denumire, UM, Cantitate) ──
// Antetul se caută în primele RANDURI_ANTET_EXCEL rânduri ale foii (comportamentul istoric al catalogului). Cu opțiunea explicită
// { antetOriunde: true } (DOAR Rest de decontat, parseDevizModificare) se caută în TOATĂ foaia, ca un deviz AA cu note lungi
// deasupra tabelului să nu fie citit ca „fără articole” (review #1165 r2 P1, L12).
// Cu { contabilizare: true } (DOAR Rest de decontat, review #1165 r5) se aplică INVARIANTUL din restDecontat/contabilizare.js — aceeași funcție
// ca la situație: rândurile se citesc cu rândurile goale (indicele + 1 = rândul Excel), fiecare rând ne-gol primește o clasă (titlu /
// ignorat cu motiv deasupra antetului, antet, articol / os / diverse, total, problema), o foaie FĂRĂ antet nu mai e sărită tăcut (rândurile ei
// de articol devin probleme), un rând cu cifre sărit (cantitate / UM / denumire lipsă, număr neinterpretabil sau ambiguu) e problemă; numerele
// ca text se citesc cu `numar` (parseNumar, RO / EN, semn), nu cu `num` (care citește „1.234,5” drept 1,2345). Rezultatul devine
// { articole, probleme, contabilizare }. FĂRĂ opțiune totul rămâne identic cu main (blankrows: false, num, rândurile sărite tăcut, array).
const RANDURI_ANTET_EXCEL = 30
const RE_UM_ANTET = /^u\.?\s?m\.?$/
export async function parseDevizExcel(arrayBuffer, { antetOriunde = false, contabilizare = false } = {}) {
  const _x = await import('xlsx-js-style')
  const XLSX = _x.default?.read ? _x.default : _x
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const out = [], probleme = [], sumar = {}
  for (const name of wb.SheetNames) {
    // contabilizare: cu rândurile goale și DE LA A1 (`!ref` poate începe mai jos; indice + 1 = rândul Excel); implicit: ca pe main
    const rows = contabilizare ? randuriDeLaA1(XLSX, wb.Sheets[name]) : XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' })
    const clase = []
    const cls = contabilizare ? (r, clasa, motiv) => clase.push(motiv ? { rand: r + 1, clasa, motiv } : { rand: r + 1, clasa }) : () => {}
    const problema = (r, motiv, extra) => { probleme.push({ foaie: name, rand: r + 1, motiv, ...extra }); cls(r, 'problema') }
    // caută rândul de antet
    let hdr = -1, col = {}
    const randuriAntet = antetOriunde ? rows.length : Math.min(rows.length, RANDURI_ANTET_EXCEL)
    for (let r = 0; r < randuriAntet; r++) {
      const cells = rows[r].map(c => String(c).toLowerCase())
      const find = (kw) => cells.findIndex(c => kw.some(k => c.includes(k)))
      // coloana UM: regula veche `includes('um')` prinde și „denUMire” (prima coloană potrivită) — sub contabilizare celula trebuie să FIE
      // „UM” / „U.M.” sau să conțină „unitat”; implicit rămâne regula veche (catalog, identic cu main)
      const ic = find(['cantitat']), iu = contabilizare ? cells.findIndex(c => RE_UM_ANTET.test(c.trim()) || c.includes('unitat')) : find(['u.m', 'um', 'unitat']), id = find(['denumire', 'articol', 'lucrar'])
      if (ic >= 0 && iu >= 0) { hdr = r; col = { cant: ic, um: iu, den: id >= 0 ? id : 1, cod: find(['simbol', 'cod', 'indicativ']) }; break }
    }
    if (hdr < 0) {
      // foaie fără antet de deviz: implicit sărită (catalog, ca pe main); sub contabilizare fiecare rând ne-gol e „ignorat” cu motiv, iar
      // rândurile ei de articol le scoate invariantul la probleme (review #1165 r4 P1: foaia „Detaliu” fără antet dispărea tăcut)
      if (contabilizare) {
        rows.forEach((row, r) => { if (eRandGol(row)) return; if (eMetaDocument(row)) cls(r, 'meta_document'); else cls(r, 'ignorat', 'foaie fără antet de deviz (Cantitate + UM)') })
        const inv = verificaContabilizare(name, rows, clase)
        probleme.push(...inv.probleme); sumar[name] = inv.sumar
      }
      continue
    }
    for (let r = 0; r < hdr; r++) { if (eRandGol(rows[r])) continue; if (eMetaDocument(rows[r])) cls(r, 'meta_document'); else if (eRandDate(rows[r])) cls(r, 'ignorat', 'deasupra antetului, cu cifre'); else cls(r, 'titlu') }
    cls(hdr, 'antet')
    for (let r = hdr + 1; r < rows.length; r++) {
      const row = rows[r]
      if (contabilizare && eRandGol(row)) continue
      const brutCant = row[col.cant]
      const cant = contabilizare ? numar(brutCant) : num(brutCant), um = String(row[col.um] || '').trim()
      const den = String(row[col.den] || '').trim()
      const cod = col.cod >= 0 ? String(row[col.cod] || '').trim() : ''
      if (contabilizare) {
        // TOTAL doar cu dovadă (review #1165 r5 P1-2, aceeași regulă ca la situație): etichetă „Total …” ȘI fără cod de articol, fără UM
        // din lista comună, fără cantitate; „Total station montaj | m | 3” merge mai departe ca articol sau problemă, nu total tăcut
        if (eTotalDovedit({ etichete: [den, cod], cod, um, cantitati: [cant] })) { cls(r, 'total'); continue }
        if (Number.isNaN(cant)) { problema(r, `cantitate neinterpretabilă „${String(brutCant).trim()}”`, { cod, denumire: den }); continue }
        if (typeof brutCant === 'string' && RE_NUMAR_AMBIGUU.test(brutCant.trim())) { problema(r, `cantitate ambiguă (mii sau zecimale?) „${brutCant.trim()}”`, { cod, denumire: den }); continue }
        if (cant == null || !um || !den) {
          if (!eRandDate(row) && !randCandidat(row)) { cls(r, 'ignorat', 'text fără cifre, fără cantitate'); continue }
          const lipsesc = [cant == null ? 'cantitate' : '', um ? '' : 'UM', den ? '' : 'denumire'].filter(Boolean)
          problema(r, `rând cu conținut sărit: lipsesc ${lipsesc.join(', ')}`, { cod, denumire: den })
          continue
        }
      } else if (cant == null || !um || !den) continue
      out.push({ obiect_cod: '', obiect_nume: name, deviz_cod: '', deviz_nume: '', nr: String(r), cod, denumire: den.slice(0, 200), um, cantitate: cant, valoare: null })
      cls(r, tipRand(den, cod))
    }
    if (contabilizare) { const inv = verificaContabilizare(name, rows, clase); probleme.push(...inv.probleme); sumar[name] = inv.sumar }
  }
  return contabilizare ? { articole: out, probleme, contabilizare: sumar } : out
}

// ── Extras de materiale (Formular C6 — „Lista consumurilor de resurse materiale") ──
// Foaia „materiale": antet cu Nr/Denumire/UM/Consumuri/Pret/Valoare, date de la
// rândul următor. Denumirea începe cu codul numeric de material (ex. „2000092 OTEL…").
// Foaia pe care o citește ecranul „Materiale” (fără opțiunea `foaie`): „materiale” dacă există, altfel prima.
// Exportată ca regula să aibă o singură definiție (scripts/materiale_oferta o raportează, nu o copiază).
export function foaieImplicitaExtras(wb) {
  return Object.prototype.hasOwnProperty.call(wb.Sheets, 'materiale') ? 'materiale' : wb.SheetNames[0]
}
// `foaie` (opțional): numele EXACT al foii de citit; foaie inexistentă = eroare, nu altă foaie.
// Ecranul nu o dă, deci comportamentul lui rămâne cel de mai sus. scripts/materiale_oferta dă foaia
// identificată determinist ca C6 (marcajul „FORMULAR C6”), ca ordinea / numele foilor să nu schimbe paritatea.
export async function parseExtrasMateriale(file, { foaie } = {}) {
  const _x = await import('xlsx-js-style')
  const XLSX = _x.default?.read ? _x.default : _x
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  if (foaie != null && !wb.SheetNames.includes(foaie)) throw new Error(`Foaia „${foaie}" nu există în fișier`)
  const numeFoaie = foaie != null ? foaie : foaieImplicitaExtras(wb)
  const sheet = wb.Sheets[numeFoaie]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
  let hdr = -1
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase())
    if (cells.some(c => c.includes('denumirea resursei')) && cells.some(c => c.includes('consumuri'))) { hdr = r; break }
  }
  if (hdr < 0) throw new Error(`Nu găsesc antetul C6 (Denumirea resursei / Consumuri) în foaia „${foaie != null ? foaie : 'materiale'}"`)
  const out = []
  for (let r = hdr + 1; r < rows.length; r++) {
    const [nr, den, um, cant, pret, val, furnizor] = rows[r]
    const cantitate = num(cant)
    const d = String(den || '').trim()
    if (!d || cantitate == null || !String(um || '').trim()) continue
    if (!/^\d+$/.test(String(nr).trim())) continue // sar subtotaluri/EURO/semnături
    if (!/[A-Za-z]/.test(d)) continue // sar rândul cu indecșii de coloane (0|1|2|…)
    const mc = d.match(/^(\d{5,})\s+(.*)$/) // cod material numeric la început
    out.push({
      obiect_cod: '', obiect_nume: 'MATERIALE (extras C6)', deviz_cod: '', deviz_nume: '',
      nr: String(nr).trim().padStart(3, '0'), cod: mc ? mc[1] : '',
      denumire: (mc ? mc[2] : d).slice(0, 200).trim(),
      um: String(um).trim().toLowerCase().replace(/\.$/, ''), cantitate,
      valoare: num(val), pret_unitar: num(pret),
      furnizor: String(furnizor || '').trim() || null,
    })
  }
  return out
}

// ── Dispatcher pe tip fișier ──
// optiuni (opțional): { cuSemn: true } = cantitățile / totalurile negative din .docx intră cu semn; { antetOriunde: true } = pe Excel
// antetul se caută în toată foaia, nu doar în primele 30 de rânduri; { contabilizare: true } = rezultatul e { articole, probleme,
// contabilizare } cu invariantul de contabilizare aplicat (toate trei DOAR Rest de decontat, parseDevizModificare).
// Fără opțiuni = comportamentul istoric al catalogului (linia negativă din .docx se sare; antetul Excel în primele 30 de rânduri; array).
// Pe Excel numerele vin din celule prin num(), cu semnul lor, pe ambele căi (așa era și înainte: cuSemn nu schimbă calea Excel).
export async function parseDeviz(file, optiuni = {}) {
  const buf = await file.arrayBuffer()
  const nume = (file.name || '').toLowerCase()
  if (nume.endsWith('.docx')) return parseDevizDocx(buf, optiuni)
  if (nume.endsWith('.xls') || nume.endsWith('.xlsx')) return parseDevizExcel(buf, optiuni)
  // fallback: încearcă docx (zip) apoi excel
  try { return await parseDevizDocx(buf, optiuni) } catch (_) { return parseDevizExcel(buf, optiuni) }
}
