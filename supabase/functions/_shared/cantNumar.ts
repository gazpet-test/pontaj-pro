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

const RE_TOKEN = /(?<![\d.,])\d+(?:[.,]\d+)*(?![\d])/g
// datele calendaristice nu sunt cantități și nu sunt dovadă de convenție (15.10.2026 ar arăta ca mii cu punct)
const RE_DATA = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/

export type Token = { text: string; de_la: number; pana_la: number }

export function tokeniNumerici(t: string, offsetBaza = 0): Token[] {
  const out: Token[] = []
  for (const m of t.matchAll(RE_TOKEN)) {
    let tx = m[0]
    // punctuația de final de propoziție („100 m.” nu; „100.” da) — un separator fără cifre după e tăiat de regex
    out.push({ text: tx, de_la: offsetBaza + (m.index ?? 0), pana_la: offsetBaza + (m.index ?? 0) + tx.length })
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

// ── poziția dovedită (spec §4.1): citat unic în felie (spații normalizate) ȘI exact un token al cărui interpretare unică (după
// convenția documentului) e egală cu cantitatea; un token ambiguu care ar putea fi cantitatea → valoare_ambigua.
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
  conventie: Conventie
}): Pozitie {
  const nu = (motiv: string, extra: Partial<Pozitie> = {}): Pozitie =>
    ({ pozitie_dovedita: false, valoare_ambigua: false, motiv, citat_interval: null, rand_interval: null, cantitate_offset: null, ...extra })
  if (p.cantitate === null || !Number.isFinite(p.cantitate)) return nu('fara_cantitate')
  const gasite = gasesteCitat(p.felie, p.citat)
  if (gasite.length === 0) return nu('citat_negasit')
  if (gasite.length > 1) return nu('citat_multiplu')
  const [a, b] = gasite[0]
  const randDe = p.felie.lastIndexOf('\n', a - 1) + 1
  const nl = p.felie.indexOf('\n', b)
  const randPana = nl < 0 ? p.felie.length : nl
  const baza = { citat_interval: [p.felie_de_la + a, p.felie_de_la + b] as [number, number],
                 rand_interval: [p.felie_de_la + randDe, p.felie_de_la + randPana] as [number, number] }
  let potrivite: Token[] = [], ambigue = 0
  for (const k of tokeniNumerici(p.felie.slice(a, b), p.felie_de_la + a)) {
    const v = valoareInDocument(k.text, p.conventie)
    if (v === 'ambigua') { if (interpretari(k.text).some((x) => egal(x, p.cantitate!))) ambigue++ }
    else if (v !== null && egal(v, p.cantitate)) potrivite.push(k)
  }
  if (ambigue) return nu('token_ambiguu', { ...baza, valoare_ambigua: true })
  if (potrivite.length === 0) return nu('cantitate_nedovedita', baza)
  if (potrivite.length > 1) return nu('token_multiplu', baza)
  return { pozitie_dovedita: true, valoare_ambigua: false, motiv: 'ok', ...baza, cantitate_offset: potrivite[0].de_la }
}
