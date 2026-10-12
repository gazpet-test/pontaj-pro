// Lotul canonic (migrarea 20261024b, etapa 2): oglinda EXACTĂ a fn_ofertare_parse_lot(text) din SQL.
// {domeniu:'toate'|'lista'|'necunoscut', loturi:number[]}. NULL/gol = necunoscut (NU toate); „toate” doar explicit.
// Acceptă: „2”, „Lot 12”, „LOT2”, „1,2,3”, „Lot 1, Lot 2”, „loturile 1 și 3”, „1-3” (interval de cel mult 50 de loturi:
// 1-50 trece, 1-51 = necunoscut); 0, interval invers sau text liber = necunoscut.
// Oglinda e pas cu pas, cu aceleași regex-uri; diferențele de motor sunt acoperite explicit:
//   - btrim() fără listă taie DOAR spațiul ' ' (nu tab/newline) → tai doar ' ', nu .trim();
//   - \s din Postgres (glibc, UTF-8) NU include spațiile ne-separatoare (U+00A0, U+2007, U+202F, U+FEFF), pe care \s din JS
//     le include → clasa WS de mai jos e lista lui Postgres, verificată pe PG16 (C.UTF-8);
//   - lower() din Postgres face caracter cu caracter (towlower): „İ” → „i”, „Σ” → „σ” mereu; JS toLowerCase() pe șir dă
//     „i̇” (2 caractere) și sigma finală „ς” → aici se coboară caracter cu caracter, cu „İ” → „i”.
// Orice schimbare în SQL se face și aici (lot_test.ts are cazurile comparate cu SQL-ul).

export type DomeniuLot = 'toate' | 'lista' | 'necunoscut'
export type Lot = { domeniu: DomeniuLot; loturi: number[] }

const WS = '[\\t\\n\\v\\f\\r \\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000]'
const RE_LOT = /loturile|lotul|loturi|lot/g
const RE_SI = new RegExp(`${WS}+(și|si|and)${WS}+`, 'g')
const RE_SEP = new RegExp(`${WS}*([,;/-])${WS}*`, 'g')
const RE_VIRG = new RegExp(`${WS}*,${WS}*`, 'g')
const RE_WS = new RegExp(`${WS}+`, 'g')
const RE_FORMA = /^[0-9]{1,3}(-[0-9]{1,3})?(,[0-9]{1,3}(-[0-9]{1,3})?)*$/
const TOATE = ['toate', 'toate loturile', 'all', 'toate cele']
const NECUNOSCUT = (): Lot => ({ domeniu: 'necunoscut', loturi: [] })

// btrim(s, caractere): taie de la capete DOAR caracterele date (implicit spațiul, ca în Postgres)
function btrim(s: string, car = ' '): string {
  let a = 0, b = s.length
  while (a < b && car.includes(s[a])) a++
  while (b > a && car.includes(s[b - 1])) b--
  return s.slice(a, b)
}
// lower() Postgres: caracter cu caracter; un rezultat pe mai multe caractere (doar „İ”) se reduce la „i”
function lowerPg(s: string): string {
  let o = ''
  for (const ch of s) { const l = ch.toLowerCase(); o += [...l].length === 1 ? l : (ch === 'İ' ? 'i' : ch) }
  return o
}

export function parseLot(p: string | null | undefined): Lot {
  let s = lowerPg(btrim(typeof p === 'string' ? p : (p == null ? '' : String(p))))
  if (s === '') return NECUNOSCUT()
  if (TOATE.includes(s)) return { domeniu: 'toate', loturi: [] }
  s = s.replace(RE_LOT, ' ')
  s = s.replace(RE_SI, ',')
  s = s.replace(RE_SEP, '$1')
  s = s.replace(/[;/]/g, ',')
  s = s.replace(RE_VIRG, ',')
  s = btrim(s.replace(RE_WS, ','), ', ')
  s = s.replace(/,+/g, ',')
  if (!RE_FORMA.test(s)) return NECUNOSCUT()
  const rez = new Set<number>()
  for (const parte of s.split(',')) {
    if (parte.includes('-')) {
      const [x, y] = parte.split('-')
      const a = parseInt(x, 10), b = parseInt(y, 10)
      if (a < 1 || b < a || b - a >= 50) return NECUNOSCUT()
      for (let i = a; i <= b; i++) rez.add(i)
    } else {
      const a = parseInt(parte, 10)
      if (a < 1) return NECUNOSCUT()
      rez.add(a)
    }
  }
  return { domeniu: 'lista', loturi: [...rez].sort((x, y) => x - y) }
}

// O cerință/cantitate e eligibilă pentru o selecție de loturi (lotul unui set, loturile la care participăm)?
// selecție null = fără filtru (comportamentul vechi). „toate” = da. „lista” = da doar dacă se intersectează.
// „necunoscut” = NU (fail-closed: nu se presupune „toate”) — apelantul o raportează / o trimite la revizuire.
export function eligibilaPeLot(cerinta: Lot, selectie: number[] | null): boolean {
  if (selectie === null) return true
  if (cerinta?.domeniu === 'toate') return true
  if (cerinta?.domeniu !== 'lista' || !Array.isArray(cerinta.loturi)) return false
  const s = new Set(selectie.map(Number))
  return cerinta.loturi.some((x) => s.has(Number(x)))
}

// Lotul unui rând din BD: coloanele canonice (lot_domeniu/lot_nr) au prioritate; rândurile vechi (lot_domeniu NULL,
// fără backfill) se citesc din textul vechi `lot` cu aceeași parsare. Un rând „lista” fără numere valide = necunoscut.
export function lotRand(r: { lot_domeniu?: string | null; lot_nr?: unknown; lot?: string | null }): Lot {
  if (r?.lot_domeniu === 'toate') return { domeniu: 'toate', loturi: [] }
  if (r?.lot_domeniu === 'necunoscut') return NECUNOSCUT()
  if (r?.lot_domeniu === 'lista') {
    const n = Array.isArray(r.lot_nr) ? r.lot_nr.map(Number).filter((x) => Number.isInteger(x) && x >= 1) : []
    return n.length ? { domeniu: 'lista', loturi: [...new Set(n)].sort((a, b) => a - b) } : NECUNOSCUT()
  }
  return parseLot(r?.lot ?? null)
}

// Lotul din NUMELE unui fișier („CS Lot 12.pdf”, „LOT2_vol1”, „Lista_cantitati_lot_1-3.xlsx”). parseLot pe numele întreg
// ar da „necunoscut” (e text liber), așa că se caută întâi fragmentele „lot N” / „lot N-M” și abia ele trec prin parseLot.
// Niciun fragment = necunoscut; un fragment invalid (lot 0, interval invers/prea lung) = necunoscut pe tot (fail-closed).
// brut = fragmentele găsite, ca text (pentru lot_brut), null dacă nu s-a găsit nimic.
// Expresia ÎNTREAGĂ de după „lot” (review Jakarinos P2 #7: „loturile 1 si 2” dădea {1}): numerele legate prin - , ; / și
// „si/și/and”, plus legăturile pe care parseLot NU le acceptă („+”, „&”, „sau”, „or”) — prinse aici ca expresia să ajungă
// întreagă la parseLot și să devină „necunoscut”, nu o listă trunchiată.
// r2 (review Jakarinos r2 P2 #7): numele se normalizează întâi („_” → spațiu, „–”/„—” → „-”), iar o expresie poate repeta
// cuvântul „lot” între numere („Lot 1 sau Lot 2”, „Lot 1 si Lot 3”) — e UN fragment, deci o legătură refuzată oriunde în
// el („sau”, „or”, „+”, „&”) face tot numele necunoscut; nu se mai păstrează un prefix valid.
const LOT_CUV = 'lot(?:ul|urile|uri)?[\\s.:#-]*'
const RE_LOT_NUME = new RegExp(`(?<![a-z])${LOT_CUV}\\d{1,3}(?:(?:\\s*[-,;/+&]\\s*|\\s+(?:si|și|and|sau|or)\\s+)(?:${LOT_CUV})?\\d{1,3})*(?![\\d])`, 'gi')
const RE_LEGATURA_REFUZATA = /[+&]|\s(?:sau|or)\s/i
export function lotDinNumeFisier(nume: string | null | undefined): Lot & { brut: string | null } {
  const s = String(nume || '').replace(/_+/g, ' ').replace(/[–—]/g, '-')
  const potr = [...s.matchAll(RE_LOT_NUME)]
  const fr = potr.map((m) => m[0])
  if (!fr.length) return { ...NECUNOSCUT(), brut: null }
  const brut = fr.join(', ').slice(0, 200)
  // r3 (review Jakarinos r3 P2 #4): și textul DINTRE fragmente („Lot 1 sau anexa Lot 2”) — o legătură refuzată acolo = necunoscut
  for (let i = 1; i < potr.length; i++) {
    const intre = ' ' + s.slice((potr[i - 1].index ?? 0) + potr[i - 1][0].length, potr[i].index ?? 0) + ' '
    if (RE_LEGATURA_REFUZATA.test(intre)) return { ...NECUNOSCUT(), brut }
  }
  const rez = new Set<number>()
  for (const f of fr) {
    if (RE_LEGATURA_REFUZATA.test(f)) return { ...NECUNOSCUT(), brut }
    const l = parseLot(f.replace(new RegExp(LOT_CUV, 'gi'), ' '))
    if (l.domeniu !== 'lista') return { ...NECUNOSCUT(), brut }
    l.loturi.forEach((n) => rez.add(n))
  }
  return { domeniu: 'lista', loturi: [...rez].sort((a, b) => a - b), brut }
}

// Coloanele canonice de scris (lot_domeniu / lot_nr / lot_sursa / lot_brut), coerente cu CHECK-ul din BD:
// lista ⇒ lot_nr nevid; toate/necunoscut ⇒ lot_nr NULL. Triggerul din BD poate rescrie o listă cu loturi inexistente
// în „necunoscut” (lot_sursa='invalidat_lot_inexistent') — codul nu presupune că rămâne ce a scris.
export function coloaneLot(l: Lot, sursa: string, brut: string | null) {
  const lista = l.domeniu === 'lista' && l.loturi.length > 0
  return {
    lot_domeniu: lista ? 'lista' : (l.domeniu === 'toate' ? 'toate' : 'necunoscut'),
    lot_nr: lista ? [...l.loturi] : null,
    lot_sursa: sursa,
    lot_brut: brut == null ? null : String(brut).slice(0, 200),
  }
}

// Generarea / derivatele pe loturi: vezi filtreazaDerivate în eligibilLot.ts (fail-closed, review Jakarinos P1 #2).
