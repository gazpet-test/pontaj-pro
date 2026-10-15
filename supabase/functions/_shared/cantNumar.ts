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
const RE_TOKEN = /(?<![\d.,])\d{1,3}(?:[\u00a0\u202f\u2009]\d{3})+(?:[.,]\d+)?(?!\d)|(?<![\d.,])\d+(?:[.,]\d+)*(?!\d)/g
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
  if (/^(mc|m\.c|m3)$/.test(t)) return 'mc'
  if (/^(mp|m\.p|m2)$/.test(t)) return 'mp'
  if (/^(buc|bucati|boc)$/.test(t)) return 'buc'
  if (/^km$/.test(t)) return 'km'
  return /^[a-z0-9.%/]{1,10}$/.test(t) ? t : null
}

// UM-urile „lângă” un token: cuvântul imediat după / înainte (peste separatori de tabel) sau unitatea din antetul coloanei
// tabelului markdown în care stă tokenul („LUNGIME (m)”). Fără UM dovedit, tokenul NU e cantitatea (spec §4.1: „cu UM-ul lui”).
const RE_UM_DUPA = /^[\s|\])*]*([A-Za-zĂÂÎȘȚăâîșț]{1,8}(?:\.[A-Za-z]{1,3})?\.?)(?![A-Za-z0-9])/
const RE_UM_INAINTE = /(?<![A-Za-z0-9])([A-Za-zĂÂÎȘȚăâîșț]{1,8}(?:\.[A-Za-z]{1,3})?\.?)[\s|[(*]*$/
const RE_SEPARATOR_TABEL = /^\s*\|?\s*:?-{3,}/
const RE_UM_ANTET = /\((m|ml|mp|mc|buc|km)\)|\b(metri|ml)\b/i
export function umLanga(t: string, de: number, pana: number): Set<string> {
  const out = new Set<string>()
  const dupa = RE_UM_DUPA.exec(t.slice(pana, pana + 40))
  if (dupa) { const u = umNorm(dupa[1]); if (u) out.add(u) }
  const inainte = RE_UM_INAINTE.exec(t.slice(Math.max(0, de - 40), de))
  if (inainte) { const u = umNorm(inainte[1]); if (u) out.add(u) }
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
  um: string | null           // UM-ul normalizat al rândului; fără UM nu se poate dovedi poziția
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
  if (!p.um) return nu('fara_um', baza)
  let potrivite: Token[] = [], ambigue = 0
  // tokenurile din TOATĂ felia care ating citatul: un citat nu poate tăia un număr („Conducta 100” din „Conducta 1000 m” = 1000)
  for (const k of tokeniNumerici(p.felie)) {
    if (k.pana_la <= a || k.de_la >= b) continue
    if (!umLanga(p.felie, k.de_la, k.pana_la).has(p.um)) continue
    const v = valoareInDocument(k.text, p.conventie)
    const abs = { ...k, de_la: p.felie_de_la + k.de_la, pana_la: p.felie_de_la + k.pana_la }
    if (v === 'ambigua') { if (interpretari(k.text).some((x) => egal(x, p.cantitate!))) ambigue++ }
    else if (v !== null && egal(v, p.cantitate)) potrivite.push(abs)
  }
  if (ambigue) return nu('token_ambiguu', { ...baza, valoare_ambigua: true })
  if (potrivite.length === 0) return nu('cantitate_nedovedita', baza)
  if (potrivite.length > 1) return nu('token_multiplu', baza)
  return { pozitie_dovedita: true, valoare_ambigua: false, motiv: 'ok', ...baza, cantitate_offset: potrivite[0].de_la }
}
