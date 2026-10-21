// TKT-0329 B (PR3): numerele dintr-un document de licitație — convenția documentului, interpretările unui token și
// poziția dovedită a cantității (spec §4.1 „pozitieDovedita()”, §5.1, obligațiile PR3 din §6.6). Funcții pure, fără rețea.
//
// De ce: „3.995” e 3,995 sau 3.995 după convenție; „470.000” (eDevize, 3 zecimale cu punct) e 470 sau 470.000. Modelul NU decide:
// codul găsește tokenul cantității în citat și îl interpretează după convenția DOCUMENTULUI. Fără dovadă → cheia `incomplet`.
//
// Convenția: doar dovezile TARI contează — tokenuri a căror interpretare e unică ȘI arată rolul separatorilor:
//   RO (punct = mii, virgulă = zecimale): „3.995,00”, „1.234.567,8”, „1160,000” (≥ 4 cifre întregi + 3 zecimale după virgulă);
//   EN (virgulă = mii, punct = zecimale): „1,234.56”, „1160.000” (≥ 4 cifre întregi + 3 zecimale după punct).
// Tokenurile cu 1–2 zecimale („16.00”, „2,5”, „3.1”) NU sunt dovadă: pe textele reale ambele forme apar în același document
// (numerotări de capitole, citiri OCR), iar ele nu au nevoie de convenție — interpretarea lor e oricum unică.
// Dovezi tari pe ambele părți → „contradictorie”; niciuna → „nedeterminata”. În ambele cazuri tokenurile cu exact 3 cifre după
// un singur separator („3.995”, „470.000”) rămân AMBIGUE → `valoare_ambigua`, cheia `incomplet` (§6.6).
// O listă împărțită în mai multe PDF-uri (p01, p02 … din același fișier) e un singur document: convenția se calculează pe toate părțile.

export type Conventie = 'ro' | 'en' | 'nedeterminata' | 'contradictorie'

// separatorul de mii prin spațiu NEÎNTRERUPT / fin („3 995,00”) e acceptat; spațiul obișnuit NU (ar lipi „Dn 90 120 m” în 90120)
// review r4: cifrele lipite de o liter\u0103 \u00eenainte NU sunt num\u0103r (\u201em3\u201d, \u201em2\u201d, \u201eDN90\u201d, \u201ePE100\u201d, \u201eSA11G1\u201d) \u2014 exponentul unei unit\u0103\u021bi sau
// un cod nu poate deveni o cantitate dovedit\u0103
const RE_TOKEN = /(?<![\d.,\p{L}])\d{1,3}(?:[\u00a0\u202f\u2009]\d{3})+(?:[.,]\d+)?(?!\d)|(?<![\d.,\p{L}])\d+(?:[.,]\d+)*(?!\d)/gu
const curataSp = (t: string) => t.replace(/[\u00a0\u202f\u2009]/g, '')
// datele calendaristice nu sunt cantități și nu sunt dovadă de convenție (15.10.2026 ar arăta ca mii cu punct)
const RE_DATA = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/

export type Token = { text: string; de_la: number; pana_la: number }

export function tokeniNumerici(t: string, offsetBaza = 0): Token[] {
  const out: Token[] = []
  for (const m of t.matchAll(RE_TOKEN)) {
    // text = forma de interpretat (fără spațiile de mii); de_la / pana_la = intervalul exact din sursă
    out.push({ text: curataSp(m[0]), de_la: offsetBaza + (m.index ?? 0), pana_la: offsetBaza + (m.index ?? 0) + m[0].length })
  }
  return out
}

// valoarea unui token sub o convenție anume, sau null dacă tokenul e invalid în acea convenție
export function valoareSub(tok: string, c: 'ro' | 'en'): number | null {
  const mii = c === 'ro' ? '.' : ','
  const zec = c === 'ro' ? ',' : '.'
  if (!/^\d+(?:[.,]\d+)*$/.test(tok)) return null
  const iz = tok.lastIndexOf(zec)
  const intreg = iz >= 0 ? tok.slice(0, iz) : tok
  const frac = iz >= 0 ? tok.slice(iz + 1) : ''
  if (frac.includes(mii) || frac.includes(zec)) return null
  if (intreg.includes(zec)) return null           // două separatoare zecimale
  const grupuri = intreg.split(mii)
  if (grupuri.length > 1) {
    if (!/^\d{1,3}$/.test(grupuri[0]) || grupuri.slice(1).some((g) => !/^\d{3}$/.test(g))) return null
  }
  const n = Number(grupuri.join('') + (frac ? '.' + frac : ''))
  return Number.isFinite(n) ? n : null
}

// toate valorile posibile ale unui token (1 = neambiguu; 0 = nu e număr valid în nicio convenție)
export function interpretari(tok: string): number[] {
  const v = new Set<number>()
  for (const c of ['ro', 'en'] as const) { const x = valoareSub(tok, c); if (x !== null) v.add(x) }
  return [...v]
}

function dovada(tok: string): 'ro' | 'en' | null {
  if (RE_DATA.test(tok)) return null
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(tok) || /^\d{4,},\d{3}$/.test(tok)) return 'ro'
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(tok) || /^\d{4,}\.\d{3}$/.test(tok)) return 'en'
  return null
}

export function conventieDocument(texte: string | string[]): { conventie: Conventie; ro: number; en: number } {
  let ro = 0, en = 0
  for (const t of Array.isArray(texte) ? texte : [texte]) {
    for (const k of tokeniNumerici(t)) { const d = dovada(k.text); if (d === 'ro') ro++; else if (d === 'en') en++ }
  }
  const conventie: Conventie = ro && en ? 'contradictorie' : ro ? 'ro' : en ? 'en' : 'nedeterminata'
  return { conventie, ro, en }
}

// valoarea unui token în documentul cu convenția dată: unică → număr; ambiguă → 'ambigua'; invalidă → null
export function valoareInDocument(tok: string, c: Conventie): number | 'ambigua' | null {
  const toate = interpretari(tok)
  if (!toate.length) return null
  if (toate.length === 1) return toate[0]
  if (c === 'ro' || c === 'en') return valoareSub(tok, c)
  return 'ambigua'
}

// ── UM (mutat aici din cantNormalizare: poziția dovedită cere UM-ul tokenului) ──
const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
export function umNorm(v: unknown): string | null {
  const t = faraDiacritice(String(v ?? '')).toLowerCase().replace(/\s+/g, '').replace(/\.$/, '')
  if (!t) return null
  if (/^(m|ml|m\.l|mliniar|metri|metru)$/.test(t)) return 'm'
  if (/^(mc|m\.c|m3|m³)$/.test(t)) return 'mc'
  if (/^(mp|m\.p|m2|m²)$/.test(t)) return 'mp'
  if (/^(buc|bucati|boc)$/.test(t)) return 'buc'
  if (/^km$/.test(t)) return 'km'
  return /^[a-z0-9.%/]{1,10}$/.test(t) ? t : null
}

// UM-urile „lângă” un token: cuvântul imediat după / înainte sau unitatea din antetul coloanei tabelului markdown („LUNGIME (m)”).
// Fără UM dovedit, tokenul NU e cantitatea (spec §4.1: „cu UM-ul lui”). Review r2: un token-diametru (după Dn / De / Ø / D=) nu e
// niciodată o cantitate; trecerea peste un separator de celulă „|” e permisă doar dacă tokenul e SINGUR în celula lui (o cantitate
// dintr-o coloană proprie), ca unitatea coloanei vecine să nu fie atribuită diametrului din denumire („| Conducta DN90 | m | 120 |”).
const RE_UM_DUPA = /^([\s\])*]*)(\|?)([\s\])*]*)([A-Za-zĂÂÎȘȚăâîșț]{1,8}[23²³]?(?:\.[A-Za-z]{1,3})?\.?)(?![A-Za-z0-9])/
const RE_UM_INAINTE = /(?<![A-Za-z0-9])([A-Za-zĂÂÎȘȚăâîșț]{1,8}[23²³]?(?:\.[A-Za-z]{1,3})?\.?)([\s[(*]*)(\|?)([\s[(*]*)$/
const RE_SEPARATOR_TABEL = /^\s*\|?\s*:?-{3,}/
const RE_UM_ANTET = /\((m|ml|mp|mc|m2|m3|m²|m³|buc|km)\)|\b(metri|ml)\b/i
const RE_PREFIX_DN = /(?:\bdn|\bde|ø|Ø|φ|\bd\s*=)\s*$/i

function singurInCelula(t: string, de: number, pana: number): boolean {
  const ls = t.lastIndexOf('\n', de - 1) + 1
  const le0 = t.indexOf('\n', pana)
  const linie = t.slice(ls, le0 < 0 ? t.length : le0)
  const st = t.lastIndexOf('|', de - 1), dr = t.indexOf('|', pana)
  if (!linie.includes('|') || st < ls || dr < 0 || (le0 >= 0 && dr > le0)) return false
  return t.slice(st + 1, de).replace(/[\s*]/g, '') === '' && t.slice(pana, dr).replace(/[\s*]/g, '') === ''
}

export function umLanga(t: string, de: number, pana: number): Set<string> {
  const out = new Set<string>()
  // prefixul de diametru, oricâte spații ar fi între el și număr (review r4): se caută de la începutul rândului până la token
  if (RE_PREFIX_DN.test(t.slice(t.lastIndexOf('\n', de - 1) + 1, de))) return out
  const singur = singurInCelula(t, de, pana)
  const dupa = RE_UM_DUPA.exec(t.slice(pana, pana + 40))
  if (dupa && (!dupa[2] || singur)) { const u = umNorm(dupa[4]); if (u) out.add(u) }
  const inainte = RE_UM_INAINTE.exec(t.slice(Math.max(0, de - 40), de))
  if (inainte && (!inainte[3] || singur)) { const u = umNorm(inainte[1]); if (u) out.add(u) }
  // antetul coloanei: rândul curent e un rând de tabel; antetul = rândul dinaintea separatorului |---|
  const ls = t.lastIndexOf('\n', de - 1) + 1
  const le0 = t.indexOf('\n', pana)
  const linie = t.slice(ls, le0 < 0 ? t.length : le0)
  if (linie.includes('|')) {
    const col = (t.slice(ls, de).match(/\|/g) || []).length
    let p = ls - 1
    for (let k = 0; k < 400 && p > 0; k++) {
      const a = t.lastIndexOf('\n', p - 1) + 1
      const l = t.slice(a, p)
      if (RE_SEPARATOR_TABEL.test(l)) {
        const h0 = t.lastIndexOf('\n', a - 2) + 1
        const cel = t.slice(h0, a - 1).split('|')[col] || ''
        const m = RE_UM_ANTET.exec(faraDiacritice(cel))
        if (m) { const u = umNorm(m[1] || m[2]); if (u) out.add(u) }
        break
      }
      if (!l.includes('|')) break
      p = a - 1
    }
  }
  return out
}

// ── poziția dovedită (spec §4.1): citat unic în felie (spații normalizate) ȘI exact un token al cărui interpretare unică (după
// convenția documentului) e egală cu cantitatea, cu UM-ul rândului; un token ambiguu care ar putea fi cantitatea → valoare_ambigua.
export type Pozitie = {
  pozitie_dovedita: boolean
  valoare_ambigua: boolean
  motiv: string
  citat_interval: [number, number] | null
  rand_interval: [number, number] | null
  cantitate_offset: number | null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function gasesteCitat(felie: string, citat: string): [number, number][] {
  const bucati = String(citat || '').trim().split(/\s+/).filter(Boolean)
  if (!bucati.length) return []
  const re = new RegExp(bucati.map(escapeRe).join('\\s+'), 'g')
  const out: [number, number][] = []
  for (const m of felie.matchAll(re)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  return out
}

const egal = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

export function pozitieDovedita(p: {
  felie: string               // textul feliei
  felie_de_la: number         // offsetul absolut al feliei în document
  citat: string
  cantitate: number | null
  um: string | null           // UM-ul normalizat al rândului; fără UM nu se poate dovedi poziția
  conventie: Conventie
  text_doc?: string           // textul ÎNTREG al documentului (review r2: tokenii și UM-ul se citesc din document, nu din felie,
                              // ca un număr tăiat la marginea feliei — „100” din „1000” — să nu fie dovedit); lipsă = felia e tot documentul
}): Pozitie {
  const nu = (motiv: string, extra: Partial<Pozitie> = {}): Pozitie =>
    ({ pozitie_dovedita: false, valoare_ambigua: false, motiv, citat_interval: null, rand_interval: null, cantitate_offset: null, ...extra })
  if (p.cantitate === null || !Number.isFinite(p.cantitate)) return nu('fara_cantitate')
  const gasite = gasesteCitat(p.felie, p.citat)
  if (gasite.length === 0) return nu('citat_negasit')
  if (gasite.length > 1) return nu('citat_multiplu')
  const doc = p.text_doc ?? p.felie
  const baza0 = p.text_doc === undefined ? 0 : p.felie_de_la    // offsetul feliei în `doc`
  const A = baza0 + gasite[0][0], B = baza0 + gasite[0][1]      // citatul în `doc`
  const randDe = doc.lastIndexOf('\n', A - 1) + 1
  const nl = doc.indexOf('\n', B)
  const randPana = nl < 0 ? doc.length : nl
  const abs = (x: number) => x - baza0 + p.felie_de_la            // poziție în `doc` → offset absolut în document
  const baza = { citat_interval: [abs(A), abs(B)] as [number, number], rand_interval: [abs(randDe), abs(randPana)] as [number, number] }
  if (!p.um) return nu('fara_um', baza)
  let potrivite: Token[] = [], ambigue = 0
  // tokenurile DOCUMENTULUI care ating citatul (o fereastră în jurul lui): un citat sau o margine de felie nu pot tăia un număr
  const w0 = Math.max(0, A - 64), w1 = Math.min(doc.length, B + 64)
  for (const k of tokeniNumerici(doc.slice(w0, w1), w0)) {
    if (k.pana_la <= A || k.de_la >= B) continue
    // un token care atinge marginea ferestrei poate fi tăiat → nedovedit (fail-closed)
    if ((k.de_la === w0 && w0 > 0) || (k.pana_la === w1 && w1 < doc.length)) return nu('token_la_margine', baza)
    if (!umLanga(doc, k.de_la, k.pana_la).has(p.um)) continue
    const v = valoareInDocument(k.text, p.conventie)
    if (v === 'ambigua') { if (interpretari(k.text).some((x) => egal(x, p.cantitate!))) ambigue++ }
    else if (v !== null && egal(v, p.cantitate)) potrivite.push({ ...k, de_la: abs(k.de_la), pana_la: abs(k.pana_la) })
  }
  if (ambigue) return nu('token_ambiguu', { ...baza, valoare_ambigua: true })
  if (potrivite.length === 0) return nu('cantitate_nedovedita', baza)
  if (potrivite.length > 1) return nu('token_multiplu', baza)
  return { pozitie_dovedita: true, valoare_ambigua: false, motiv: 'ok', ...baza, cantitate_offset: potrivite[0].de_la }
}

// ── rândul sursei în jurul cantității (val 2, PR-A „dovada pe rând”): codul și Dn-ul se verifică pe rândul cantității, nu oriunde în
// citatul ales de model (riscul DN63/DN110: o cantitate dovedită lângă denumirea altui rând). Rândul de tabel markdown („|…|”) = linia
// lui. Altfel = linia cantității; liniile de DEDESUBT intră în bloc DOAR cu delimitare POZITIVĂ (review Jakarinos r1, P1): lista F3
// pdftotext închide fiecare articol cu rândul lui „0.000 0 Total=” („003 SA11G1 [ 2] M 1160.000” / denumirea / „0.000 0 Total=”), deci
// continuarea e acceptată numai dacă se termină într-o astfel de linie de total, în cel mult LINII_CONTINUARE linii, fără să treacă
// printr-un început de articol (nr. crt. + cod) sau printr-o linie-ancoră (token numeric cu UM real) sau peste o linie goală / un marcaj
// de pagină / sfârșitul textului. Orice altceva = apartenență incertă → blocul rămâne DOAR linia cantității (fail-closed: în listele cu
// denumirea DEASUPRA cantității, denumirea de dedesubt e a articolului următor; rândul rămâne nedovedit, nu primește Dn-ul vecinului).
export const LINII_CONTINUARE = 4
// linia de total a articolului: fără litere în afară de „Total=” (cifre, punctuație și glife citite greșit, ex. „0.000 ✓ 0 Total=”)
const RE_TOTAL_RAND = /^[^\p{L}]*\btotal[ea]?\s*=[^\p{L}]*$/iu
// antetul de pagină din listele exportate („IOANA8 pag 2”, „ISL08 pag 4”): un singur cuvânt + „pag” + număr, toată linia
// review Jakarinos #815 r1 (P3): forma strictă — un singur cod alfanumeric (nu „DN…”), spațiu, „pag” / „pag.”, spațiu, număr
const RE_ANTET_PAGINA = /^\s*(?!DN)[A-Z][A-Z0-9_-]{1,39}\s+pag\.?\s+\d{1,4}\s*$/i
// marcajul de pagină COMPLET (nu doar prefixul): „⟦PAGINA n⟧”
// caracterele U+27E6 / U+27E7 scrise ca escape-uri (review r2: transportul ASCII al diff-ului le transforma în „[[” / „]]”)
const RE_MARCAJ_PAGINA = /^\u27E6PAGINA \d{1,5}\u27E7\s*$/
// prima linie ne-goală DEASUPRA liniei care începe la `a` e un marcaj de pagină
function subMarcajPagina(doc: string, a: number): boolean {
  let p = a - 1
  while (p > 0) {
    const b = doc.lastIndexOf('\n', p - 1) + 1
    const l = doc.slice(b, p)
    if (l.trim()) return RE_MARCAJ_PAGINA.test(l)
    p = b - 1
  }
  return false
}
// decizia Răzvan 21.10.2026 (cazul iii, varianta A — aceeași regulă ca inventarul B1, cantAcoperire „posibila_continuare”): sub un
// articol numerotat CU zerouri („003 6701152 M 200.000”), o linie „<n> COD <cod>” cu n FĂRĂ zerouri care NU continuă secvența (n nu e
// nr. articolului, următorul sau 1) e continuarea denumirii rupte („… DN 90X8.” / „2 COD 64000115”), nu început de articol. Orice altă
// formă rămâne început de articol (blocul se oprește → incert). Verificările de cod / cantitate / UM de dedesubt se aplică în continuare.
const RE_CONTINUARE_COD = /^\s*(\d{1,4})\s+COD\s+\S/i
const RE_NR_ARTICOL = /^\s*\**\s*(\d{1,4})[.)]?\s/
// review Copilot #819 r1 (P1): numărul care nu continuă secvența NU ajunge singur (un restart real „003” → „2 COD …” fără cantitate ar
// înghiți denumirea articolului 2). Se cere și semnalul POZITIV al formei rupte reale: linia de DEASUPRA, din bloc (nu linia articolului),
// se termină cu un număr tăiat după punctul zecimal („… DN 90X8.”, eventual urmat de coloane de preț „0.00 0.00”), pe care „<n>” îl continuă
const RE_COLOANE_PRET = /(?:\s+\d+[.,]\d{2})+\s*$/
function continuareCod(linieArticol: string, l: string, anterioara: string | null): boolean {
  const mc = RE_CONTINUARE_COD.exec(l), ma = RE_NR_ARTICOL.exec(linieArticol)
  if (!mc || !ma || !/^0\d/.test(ma[1]) || /^0/.test(mc[1]) || anterioara === null) return false
  if (!/\d\.$/.test(anterioara.replace(RE_COLOANE_PRET, '').trimEnd())) return false
  const na = Number(ma[1]), nc = Number(mc[1])
  return ![na, na + 1, 1].includes(nc)
}
const RE_INCEPUT_ARTICOL = /^\s*\**\s*\d{1,4}[.)]?\s+\**[A-Z0-9][A-Za-z0-9.\-\/]{2,}/
// doar unitățile reale fac o linie ancoră (umNorm întoarce și cuvinte oarecare: „TEAVA 20.80” nu e un rând nou)
const UM_ANCORA = new Set(['m', 'mc', 'mp', 'km', 'buc', 'kg', 't', 'to', 'l', 'set', 'ora', 'h'])

// ── orientarea listei, certificată pe DOCUMENT (review Jakarinos r5, P1): local, „Total= / denumire / Total=” e ambiguu — poate fi
// „articol, denumire DEDESUBT, total” sau „denumire DEASUPRA, total, articol” repetat. Ce le deosebește e structura întregii liste:
// în aranjamentul „dedesubt” (a) primul articol NU e precedat de o linie „… Total=” (deasupra lui e antetul / începutul) și
// (b) FIECARE articol are o linie „Total=” proprie (pe linia lui sau sub ea) înaintea articolului următor / sfârșitului textului.
// Aranjamentul „deasupra” le încalcă pe amândouă (primul articol vine după totalul primei denumiri; ultimul n-are total după el).
// Articol = început de articol (nr. + cod) cu o cantitate în formatul listei („300.000”). Fără niciun articol → necertificat.
const RE_CANT_LISTA = /(?<![\d.,])\d+[.,]\d{3}(?![\d.,])/
const RE_TOTAL_ORIUNDE = /\btotal[ea]?\s*=/i
let cacheOrientare: { doc: string; dedesubt: boolean } | null = null
export function orientareDedesubt(doc: string): boolean {
  if (cacheOrientare?.doc === doc) return cacheOrientare.dedesubt
  const L = doc.split('\n')
  const art: number[] = []
  L.forEach((l, i) => { if (RE_INCEPUT_ARTICOL.test(l) && RE_CANT_LISTA.test(l)) art.push(i) })
  let ok = art.length > 0
  if (ok) {
    let p = art[0] - 1
    while (p >= 0 && (!L[p].trim() || L[p].startsWith('⟦PAGINA'))) p--
    if (p >= 0 && RE_TOTAL_ORIUNDE.test(L[p])) ok = false
  }
  for (let k = 0; ok && k < art.length; k++) {
    const sfarsit = k + 1 < art.length ? art[k + 1] : L.length
    let are = false
    for (let j = art[k]; j < sfarsit && !are; j++) are = RE_TOTAL_ORIUNDE.test(L[j])
    if (!are) ok = false
  }
  cacheOrientare = { doc, dedesubt: ok }
  return ok
}

export function blocRand(doc: string, off: number): { linie: string; bloc: string; de_la: number; pana_la: number; continuare: boolean } {
  const ls = doc.lastIndexOf('\n', off - 1) + 1
  const le0 = doc.indexOf('\n', off)
  const le = le0 < 0 ? doc.length : le0
  const linie = doc.slice(ls, le)
  const doarLinia = { linie, bloc: linie, de_la: ls, pana_la: le, continuare: false }
  if ((linie.match(/\|/g) || []).length >= 2) return doarLinia
  // review Jakarinos r3/r4 (P1): denumirea e DEDESUBTUL cantității doar dacă deasupra rândului e sigur că NU e o denumire. Singura
  // dovadă acceptată: prima linie ne-goală de deasupra (marcajele de pagină sunt transparente — denumirea poate fi pe pagina
  // precedentă) închide articolul precedent („… Total=”). Antetul listei, începutul textului sau orice altceva = incert → doar linia
  // (primul articol al fiecărei liste rămâne pe linia lui). Un „Total=” chiar pe linia cantității = articolul e întreg pe linie.
  if (/\btotal[ea]?\s*=/i.test(linie)) return doarLinia
  if (!orientareDedesubt(doc)) return doarLinia
  let p = ls - 1, sus = ''
  while (p > 0) {
    const a = doc.lastIndexOf('\n', p - 1) + 1
    const l = doc.slice(a, p)
    // decizia Răzvan 21.10.2026 (propunerea 2A-i, proba Răcari): antetul de pagină „<cod> pag N” e transparent ca marcajul — DOAR
    // dacă e chiar prima linie ne-goală de sub un marcaj ⟦PAGINA n⟧ (altfel rămâne o linie oarecare → incert, ca înainte)
    if (l.trim() && !l.startsWith('⟦PAGINA') && !(RE_ANTET_PAGINA.test(l) && subMarcajPagina(doc, a))) { sus = l; break }
    p = a - 1
  }
  if (!RE_TOTAL_RAND.test(sus)) return doarLinia
  let pana = le
  let anterioara: string | null = null   // linia de deasupra din bloc (null = linia articolului)
  for (let k = 0; k <= LINII_CONTINUARE && pana < doc.length; k++) {
    const a = pana + 1
    const b0 = doc.indexOf('\n', a)
    const b = b0 < 0 ? doc.length : b0
    const l = doc.slice(a, b)
    if (RE_TOTAL_RAND.test(l)) return k === 0 ? doarLinia : { linie, bloc: doc.slice(ls, pana), de_la: ls, pana_la: pana, continuare: true }
    if (k === LINII_CONTINUARE || !l.trim() || l.startsWith('⟦PAGINA') || (RE_INCEPUT_ARTICOL.test(l) && !continuareCod(linie, l, anterioara))) return doarLinia
    // review Jakarinos r2 (P1): un articol fără nr. și fără UM („SA11H1 120.000”) nu e continuare — linia care începe cu un cod sau
    // conține o cantitate în formatul listei (trei zecimale: „120.000”) oprește blocul (incert → doar linia cantității)
    if (codComparabil(l.trim().split(/\s+/)[0]) !== null || /(?<![\d.,])\d+\.\d{3}(?![\d.,])/.test(l)) return doarLinia
    if (tokeniNumerici(l, a).some((t) => [...umLanga(doc, t.de_la, t.pana_la)].some((u) => UM_ANCORA.has(u)))) return doarLinia
    anterioara = l
    pana = b
  }
  return doarLinia
}

// codul de articol al modelului, comparabil: majuscule, fără „*”; doar coduri „reale” (≥ 3 caractere, cel puțin o cifră și o literă
// sau ≥ 5 cifre) — un „1” sau „a)” nu se verifică. Un cod cu spații în interior nu e un identificator → null (nu se verifică), dar
// nici nu poate dovedi nimic: verificaRand îl tratează ca „cod declarat, negăsit”.
export function codComparabil(v: unknown): string | null {
  const t = String(v ?? '').replace(/\*/g, '').trim().toUpperCase()
  // 20.10.2026 (proba Răcari, A vs B): codurile de normă cu „%” la coadă („GD19A1%”, „GD20A1%”) sunt identificatori reali — înainte
  // ieșeau „cod_neverificabil” (0 din 32 de rânduri dovedite); „%” e acceptat DOAR ca ultim caracter
  if (t.length < 3 || t.length > 40 || !/^[A-Z0-9][A-Z0-9.\-\/]*%?$/.test(t)) return null
  return /\d/.test(t) && (/[A-Z]/.test(t) || /\d{5,}/.test(t)) ? t : null
}

// identificatorii întregi ai unei linii (review Jakarinos r1, P1: codul se compară ca identificator, nu ca subșir — „SA11G1” nu se
// potrivește în „SA11G10”, iar „SA11G1M” nu se poate fabrica din „SA11G1 M”)
export function identificatoriLinie(linie: string): Set<string> {
  return new Set(linie.toUpperCase().split(/[\s|*\[\](),;:]+/).map((x) => x.replace(/^[.\-\/]+|[.\-\/]+$/g, '')).filter(Boolean))
}
