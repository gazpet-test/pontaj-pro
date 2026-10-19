// Val 2, PR-B1: INVENTARUL INDEPENDENT de rânduri — funcții pure, fără rețea, fără model. Poarta de completitudine a extractorului A
// (plan aprobat de Răzvan 17.10): rândurile extrase de model se compară (B2) cu rândurile pe care textul spune că le are.
// Principiul (review Jakarinos #751 r1): un rând NUMEROTAT intră ÎNTOTDEAUNA în inventar — ce nu recunoaștem (UM în afara listei,
// separator de mii prin spațiu, cantitate pe linia de dedesubt, coloane îndepărtate) rămâne în numitor ca „incert”, nu dispare.
// O ancoră falsă costă doar o verificare / escaladare; o ancoră pierdută ascunde o omisiune.
// Offseturile sunt în textul ORIGINAL (primit), nu în vreo formă normalizată.
import { tokeniNumerici, umLanga } from './cantNumar.ts'

// unitățile recunoscute pentru clasificarea „ancoră” (formele din devize: „TONA”, „M CUB” → cuvântul vecin e „CUB”, „SUTE MC” → „MC”,
// „BUCATA”, „LITRU”, „KWH”); orice altă UM lasă rândul „incert”, NU îl scoate din inventar
export const UM_REALE = new Set(['m', 'mc', 'mp', 'km', 'buc', 'kg', 't', 'to', 'tona', 'tone', 'cub', 'bucata', 'bucati', 'l', 'litru',
  'litri', 'kwh', 'set', 'cpl', 'perechi', 'ora', 'ore', 'h'])
// începutul unui rând numerotat: „003 SA11G1 …”, „12. Conducta …”, „**7** …”, „**7**. …”, ierarhic DOAR în tabel „5.1 | …” (nr. = prima
// componentă; în listă „213.76 …” ar fi o linie de prețuri);
// la tabel (≥ 2 „|”) nr. e prima celulă
// review Copilot r14: și „1: Conducta”, „1)Conducta”, „1:Conducta”, „1.Conducta” (separator lipit de text, doar înaintea unei LITERE sau
// paranteze — „1.5 …”, „10:30” nu devin rânduri plate)
const RE_NR_LISTA = /^\s*\**\s*(\d{1,4})\**(?:[.):]\**(?:\s+|(?=[\p{L}(\[]))|\s+)\S/u
// numerotarea ierarhică în LISTĂ („5.1 Conducta”, „1000.1 …”, „5.1 m 10”, „5.1 2509 Teava”, „5.1 3A1iG1 …”, „5.1 A se vedea”, „5.1 (Conducta”)
// — review Copilot r7 / r8, Gemini r8. Ce o urmează: un cuvânt de ≥ 2 litere; un cuvânt de o literă care NU e o UM (m / t / l) urmat de
// alt cuvânt; o paranteză; un cod alfanumeric (orice majuscule / minuscule, cu literă și cifră); un cod numeric de ≥ 4 cifre FĂRĂ zecimale;
// sau o UM urmată de un număr („5.1 m 10”). Ce nu e pe lista albă („213.76 65795.33”, „5.1 12,50”,
// „1.5 m adancime”) intră ca rând slab → incert „posibila_continuare”, nu dispare.
const RE_NR_LISTA_IER_STRUCT = /^\s*\**\s*(\d{1,4}(?:\.\d{1,3})+)\**(?:[.):]\**(?:\s+|(?=[\p{L}(\[]))|\s+)(?=\S)/u
// nr. crt. SINGUR pe linie („1”, „5.1”, „12.”) — OCR care rupe după nr. (review Copilot r12): rând „slab”; cu cantitate + UM pe linia
// următoare devine rând normal („1” / „Conducta m 10”), altfel incert „posibila_continuare” (în inventar, tabel nedeterminat)
const RE_NR_SINGUR = /^\s*\**\s*(\d{1,4}(?:\.\d{1,3})*)\**[.):]?\**\s*$/
// fără excludere de „linii de prețuri” (review Copilot r11): un id ierarhic urmat numai de numere („213.76 65795.33” sau un rând real
// degradat „5.1 12,50”) intră ca rând „slab” → incert „posibila_continuare” (în inventar, în afara secvenței, tabel nedeterminat).
// Pe textele valului 1 asemenea linii nu schimbă nimic (singurele sunt „0.00 0.00”, cu nr. 0, care nu e rând).
const RE_NR_LISTA_IER = /^\s*\**\s*(\d{1,4}(?:\.\d{1,3})+)\**(?:[.):]\**(?:\s+|(?=[\p{L}(\[]))|\s+)(?:[-–:]\s*)?(?=[\p{L}@][\p{L}.]+|(?![mMtTlL]\s)\p{L}\s+\p{L}|[(\[]\s*[\p{L}\d]|(?=[\p{L}\d]*\p{L})(?=[\p{L}\d]*\d)[\p{L}\d]{2,}|\d{4,}(?![.,]?\d)|(?:m|ml|km|mc|mp|m2|m3|buc|kg|t|to|l|M|ML|KM|MC|MP|M2|M3|BUC|KG|T|TO|L)\.?\s+\d)/u
const RE_NR_MARKDOWN = /^\s*\|?\s*\**\s*(\d{1,4}(?:\.\d{1,3})*)\**[.):]?\**\s*\|/
// prima celulă care ÎNCEPE cu un nr. dar nu are forma strictă („| 1 Conducta | …”, „| 5.2 - | …”, „| 1)a | …”, review Copilot r16): rând
// „slab” — cu cantitate + UM pe rând e rând normal, altfel incert „posibila_continuare” (în inventar, tabel nedeterminat)
const RE_NR_MARKDOWN_SLAB = /^\s*\|?\s*\**\s*(\d{1,4}(?:\.\d{1,3})*)\**(?:[.):\-–]|\s)[^|]*\|/u
const RE_MARCAJ = /^⟦PAGINA\s*(\d{1,5})⟧/
const RE_SEPARATOR = /^\s*\|?\s*:?-{3,}/
// cantitate cu separator de mii prin spațiu („1 234,50”, „2 450,00”) — tokenizarea o rupe; rândul devine „incert”, nu dispare
const RE_MII_SPATIU = /(?<![\p{L}\d.,])\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?(?![\p{L}\d.,])/u
// un cod de deviz / material: litere + cifre (TRA01A50, SA11G1, 3A1iG1) sau ≥ 5 cifre (6701152); nu „DN90”, nu „PE100”, nu „SDR11”
const RE_COD = /^(?=.*\d)(?:[A-Z][A-Z0-9]{3,}|\d[A-Z0-9]*[A-Z][A-Z0-9]*|\d{5,})$/
const NU_COD = /^(?:DN|DE|PE|PN|SDR|PEHD|HDPE|OL|PVC|D)\d/

export type Stare = 'ancora' | 'incert'
export type RandInventar = {
  offset: number            // începutul liniei rândului în textul ORIGINAL
  linie: number             // numărul liniei (1-based) în textul original
  pagina: number | null
  nr: number | null        // nr. crt. (≥ 1); null = rând de tabel fără coloană de numerotare, cu cod (C6) — nu intră în secvență
  nr_id: string | null     // identificatorul complet („5.1”, „003”); la ierarhic, nr = prima componentă (review r2, P2-6)
  cod: string | null        // codul de după nr. (după POZIȚIE, nu după egalitate textuală)
  cantitate: string | null
  um: string | null
  markdown: boolean
  stare: Stare
  motiv: string | null      // de ce e „incert”
}
// secventa_nedeterminata: în tabel (sau imediat după el) există rânduri „posibila_continuare” — golurile / granițele NU sunt dovedite;
// B2 trebuie să trateze tabelul ca „incomplet” — la fel orice tabel cu goluri, goluri_ierarhice sau reluari_atipice > 0 (contract B2);
// un tabel cu randuri = 0 și secventa_nedeterminata = true e SINTETIC (doar rânduri incerte, fără secvență sigură) (review r4: excluderea lor din secvență putea ascunde un gol, ex. „1 / 3 / 4”)
export type Tabel = { de_la: number; nr_min: number; nr_max: number; randuri: number; pozitii: number; goluri: number[]; goluri_ierarhice: string[]; reluari_atipice: number; secventa_nedeterminata: boolean; nr_incerte: number[] }
export type Masura = {
  randuri: number; ancore: number; incerte: number; ancore_cu_cod: number; perechi_distincte: number
  tabele: number; tabele_cu_goluri: number; goluri: number; reluari_atipice: number; tabele_nedeterminate: number; dupa_pagina: Record<string, number>
}

// pentru clasificare, rândurile de tabel fără „|” de închidere se închid într-o COPIE (umLanga cere ambele margini ale celulei);
// offseturile raportate rămân în original (liniile copiei au aceleași indexuri, doar lungimi diferite)
function inchide(l: string): string { return (l.match(/\|/g) || []).length >= 2 && !/\|\s*$/.test(l) ? l + ' |' : l }

function singurInCelula(linie: string, de: number, pana: number): boolean {
  const st = linie.lastIndexOf('|', de - 1), dr = linie.indexOf('|', pana)
  return st >= 0 && dr >= 0 && linie.slice(st + 1, de).replace(/[\s*]/g, '') === '' && linie.slice(pana, dr).replace(/[\s*]/g, '') === ''
}

// codul de după nr.: primul identificator de după nr. (pe aceeași linie), dacă are forma unui cod
function codDupaNr(rest: string): { cod: string | null; de: number; pana: number } {
  const m = /^[\s|*]*([A-Za-z0-9][A-Za-z0-9.\-\/]*)/.exec(rest)
  if (!m) return { cod: null, de: -1, pana: -1 }
  const id = m[1].replace(/[.\-\/]+$/, '').toUpperCase()
  const de = m.index + m[0].length - m[1].length
  return RE_COD.test(id) && !NU_COD.test(id) ? { cod: id, de, pana: de + m[1].length } : { cod: null, de: -1, pana: -1 }
}

// rândul numerotat al liniei: nr. + poziția de după el, sau null
function nrRand(l: string): { nr: number; id: string; dupa: number; markdown: boolean; slab?: boolean } | null {
  if (RE_SEPARATOR.test(l)) return null
  const pipe = (l.match(/\|/g) || []).length >= 2
  const mdTare = pipe ? RE_NR_MARKDOWN.exec(l) : null
  // linie cu „|” doar spre coadă (nu începe cu „|”, iar înaintea primului „|” nu e un nr. strict de celulă) = rând de LISTĂ — „008 GD12A1
  // BUC. 1.000 LEGATURA … | 0.000 | 0 Total=”, „025 4123214 | BUC. | 3.000 | …” (corpus 212 / 213: altfel tratate ca tabel, fără cantitate)
  const markdown = pipe && (mdTare !== null || /^\s*\|/.test(l))
  const ier = markdown ? null : RE_NR_LISTA_IER.exec(l)
  // ierarhic „slab”: structura e de rând, dar conținutul nu e pe lista albă → rând incert, nu eliminat (fără excluderi, r12)
  const slab = !markdown && !ier ? (RE_NR_LISTA_IER_STRUCT.exec(l) ?? RE_NR_SINGUR.exec(l)) : null
  const mdSlab = markdown && !mdTare ? RE_NR_MARKDOWN_SLAB.exec(l) : null
  const m = markdown ? (mdTare ?? mdSlab) : (ier ?? slab ?? RE_NR_LISTA.exec(l))
  if (!m) return null
  const id = m[1]
  const nr = Number(id.split('.')[0])
  if (!(nr >= 1)) return null
  // rândul de numerotare a coloanelor sub antet („0 | 1 | 2 | 3 …”, „1 | 2 | 3 | 4”) nu e un rând
  if (markdown && /^[\s|]*\d{1,2}(?:\s*\|\s*\d{1,2}){2,}[\s|]*$/.test(l)) return null
  return { nr, id, dupa: m.index + m[0].length - (markdown || ier || slab ? 0 : 1), markdown, ...((slab && m === slab) || (mdSlab && m === mdSlab) ? { slab: true } : {}) }
}

// cantitatea + UM ale unei linii (în copia închisă), excluzând tokenurile nr. și cod după POZIȚIE
function cantitateSiUm(t: string, ls: number, linie: string, excluse: [number, number][], markdown: boolean): { cantitate: string; um: string } | null {
  const cuUm = tokeniNumerici(linie, ls).filter((k) => {
    const de = k.de_la - ls, pana = k.pana_la - ls
    if (excluse.some(([a, b]) => de < b && pana > a)) return false
    if (/\[\s*$/.test(linie.slice(0, de))) return false        // „[ 2]” — indicele articolului din F3
    return [...umLanga(t, k.de_la, k.pana_la)].some((u) => UM_REALE.has(u))
  })
  const tok = cuUm.find((k) => markdown && singurInCelula(linie, k.de_la - ls, k.pana_la - ls)) ?? cuUm[0]
  if (!tok) return null
  return { cantitate: tok.text, um: [...umLanga(t, tok.de_la, tok.pana_la)].find((u) => UM_REALE.has(u))! }
}

// începutul unui articol: rând numerotat SAU rând de tabel cu cod în prima celulă
function incepeArticol(l: string): boolean {
  return !!nrRand(l) || ((l.match(/\|/g) || []).length >= 2 && !RE_SEPARATOR.test(l) && !!codDupaNr(l).cod)
}

export function inventarRanduri(text: string): RandInventar[] {
  const orig = text.split('\n')
  const inch = orig.map(inchide)
  const t = inch.join('\n')
  const out: RandInventar[] = []
  let pagina: number | null = null, po = 0, pi = 0
  let ultimLista: { nr: number; zero: boolean } | null = null   // ultimul rând de LISTĂ inventariat (pentru continuări)
  let ultimMarkdown = false                                       // ultimul rând inventariat era de TABEL
  for (let i = 0; i < orig.length; i++) {
    const lo = orig[i], li = inch[i]
    const startO = po, startI = pi
    po += lo.length + 1; pi += li.length + 1
    const mp = RE_MARCAJ.exec(lo)
    if (mp) { pagina = Number(mp[1]); continue }
    let r: { nr: number | null; id: string | null; dupa: number; markdown: boolean; slab?: boolean } | null = nrRand(li)
    // rând de tabel FĂRĂ nr. (C6 doar cu cod de resursă): intră în inventar dacă prima celulă e un cod — altfel un tabel nenumerotat
    // ar avea inventar gol și ar ascunde orice omisiune (review r1)
    if (!r && (li.match(/\|/g) || []).length >= 2 && !RE_SEPARATOR.test(li) && codDupaNr(li).cod) r = { nr: null, id: null, dupa: 0, markdown: true }
    if (!r) continue
    const rest = li.slice(r.dupa)
    const c = codDupaNr(rest)
    const nrSpan: [number, number] = [0, r.dupa]
    const excluse: [number, number][] = [nrSpan, ...(c.cod ? [[r.dupa + c.de, r.dupa + c.pana] as [number, number]] : [])]
    let cu = cantitateSiUm(t, startI, li, excluse, r.markdown)
    let motiv: string | null = null
    let folosit = rest
    // cantitatea / UM pe linia următoare („1 Conducta PEHD” / „m 120,000”), dacă aceea nu e începutul altui articol — numerotat SAU
    // rând de tabel cu cod (review r2, P2-5: altfel un rând C6 împrumuta cantitatea articolului următor)
    if (!cu && i + 1 < orig.length && !incepeArticol(inch[i + 1]) && !RE_MARCAJ.test(orig[i + 1])) {
      const urm = cantitateSiUm(t, startI + li.length + 1, inch[i + 1], [], (inch[i + 1].match(/\|/g) || []).length >= 2)
      if (urm) { cu = urm; folosit = rest + ' ' + inch[i + 1] }
    }
    // separator de mii prin spațiu („1 234,50”): tokenizarea l-ar rupe („1 m”) → incert, chiar dacă s-a „găsit” o cantitate (review r2, P2-4)
    if (RE_MII_SPATIU.test(folosit)) { cu = null; motiv = 'separator_mii_spatiu' }
    // LISTĂ (fără „|”) fără cod și fără cantitate recunoscută: rând INCERT, nu eliminat (review r2, P1-1) — EXCEPȚIE doar continuarea
    // evidentă de denumire: nr. care nu continuă secvența rândurilor de listă (nu e ultimul, următorul sau 1) sau un nr. fără zerouri
    // după rânduri cu zerouri („2 COD 64000115” sub „003 6701152 …”)
    // + în interiorul unui tabel cu „|” (ultimul rând inventariat era de tabel), o linie de listă fără cod și fără cantitate e continuarea
    // denumirii („1 IMBIN.(DOP/CAPAT FLANSA) D= 90 MM” între rândurile „| 16 | 00602G04 | …”)
    // review r3 (P1-1 / P1-2): o linie ambiguă NU se mai elimină — rămâne în inventar ca INCERT „posibila_continuare”, dar NU intră în
    // secvența nr. crt. (nu acoperă un gol și nu desparte tabele); B2 o tratează ca rând de verificat
    // ierarhicul „slab” fără cantitate recunoscută = posibilă continuare (ex. „1.5 m adancime”): în inventar, în afara secvenței
    const posibilaContinuare = (r.slab === true && !cu && !motiv) || !r.markdown && !c.cod && !cu && !motiv && r.nr !== null && (ultimMarkdown || (ultimLista !== null &&
        ((ultimLista.zero && !/^0\d/.test(r.id ?? '')) || ![ultimLista.nr, ultimLista.nr + 1, 1].includes(r.nr))))
    if (posibilaContinuare) motiv = 'posibila_continuare'
    if (!cu && !motiv) motiv = r.markdown || c.cod ? 'um_sau_cantitate_nerecunoscute' : 'lista_fara_cod_sau_cantitate'
    if (!posibilaContinuare) {
      if (!r.markdown && r.nr !== null) ultimLista = { nr: r.nr, zero: /^0\d/.test(r.id ?? '') }
      ultimMarkdown = r.markdown
    }
    out.push({ offset: startO, linie: i + 1, pagina, nr: r.nr, nr_id: r.id, cod: c.cod, cantitate: cu?.cantitate ?? null, um: cu?.um ?? null,
      markdown: r.markdown, stare: cu ? 'ancora' : 'incert', motiv: cu ? null : motiv })
  }
  return out
}

// tabelele = șiruri de rânduri numerotate; un tabel nou începe la reluarea de la 1 după un nr. > 1 (review r2, P1-3: și când fragmentul
// anterior n-a avut poziția 1 — altfel „8, 10” urmat de „1 … 9” ascundea golul 9). Formatul (listă / tabel) NU
// separă tabelele (review r1: altfel o schimbare de format ascundea un gol). Un nr. care scade fără să fie 1 (suprapunere de pagină,
// rând de material) = „reluare atipică”, în același tabel. Golurile = numerele dintre min și max care nu apar deloc în tabel.
export function tabele(randuri: RandInventar[]): Tabel[] {
  const t: Tabel[] = []
  let cur: (Tabel & { vazute: Set<number>; prev: number; sub: Map<string, Set<number>>; ultSub: Map<string, number> }) | null = null
  // rândurile „posibila_continuare” văzute DUPĂ ultimul rând de secvență: pot ține de tabelul curent SAU de următorul (graniță
  // nedeterminată, review r5) → dacă urmează un tabel nou, și el le primește (secventa_nedeterminata + nr_incerte)
  let pendinte: number[] = []
  let pendinteDeLa = -1
  const inchideCur = () => {
    if (!cur) return
    for (let k = cur.nr_min; k <= cur.nr_max && cur.goluri.length < 200; k++) if (!cur.vazute.has(k)) cur.goluri.push(k)
    cur.pozitii = cur.vazute.size
    // sub-pozițiile ierarhice: sub același părinte, ultima componentă trebuie să fie 1..max fără lipsuri (5.1, 5.3 → lipsă 5.2)
    for (const [par, v] of cur.sub) {
      const max = Math.max(...v)
      for (let k = 1; k <= max && cur.goluri_ierarhice.length < 200; k++) if (!v.has(k)) cur.goluri_ierarhice.push(`${par}.${k}`)
    }
    const { vazute: _v, prev: _p, sub: _s, ultSub: _u, ...tb } = cur
    t.push(tb)
  }
  for (const r of randuri) {
    if (r.nr === null) continue
    if (r.motiv === 'posibila_continuare') {
      // în afara secvenței, dar tabelul curent își pierde dovada de completitudine (semnal explicit)
      if (cur) { cur.secventa_nedeterminata = true; if (cur.nr_incerte.length < 50) cur.nr_incerte.push(r.nr) }
      if (pendinteDeLa < 0) pendinteDeLa = r.offset
      if (pendinte.length < 50) pendinte.push(r.nr)
      continue
    }
    // reluare IERARHICĂ sub același părinte (review Copilot r13: „5.1, 5.3, 5.1, 5.2, 5.3” — toate cu nr. 5 — unea cele două secvențe și
    // ascundea golul 5.2): aceeași regulă ca la rădăcină — reluarea la 1, sau o scădere la ≤ 2 după un max > 2 = tabel nou; altă scădere
    // sub același părinte = reluare atipică. Se verifică și după un alt capitol (review Gemini r14: „5.1, 5.3, 6.1, 5.1, 5.2” — părintele
    // „5” e deja văzut în tabel, deci revenirea la 5.1 e o reluare, nu continuare)
    let ierNou = false, ierAtipic = false
    if (cur && r.nr_id && r.nr_id.includes('.')) {
      const c = r.nr_id.split('.')
      for (let k = 1; k < c.length; k++) {
        const par = c.slice(0, k).join('.'), ult = Number(c[k]), ant = cur.ultSub.get(par)
        if (ant === undefined || ult >= ant) continue
        const max = Math.max(...(cur.sub.get(par) ?? [ant]))
        if ((ult === 1 && max > 1) || (ult <= 2 && max > 2)) ierNou = true
        else ierAtipic = true
        break
      }
    }
    // tabel nou: reluarea de la 1 după un nr. > 1, SAU o scădere la ≤ 2 după un nr. > 2 (review r3: poziția 1 poate fi ea însăși
    // incertă / lipsă); orice altă scădere = „reluare atipică” în același tabel (semnal pentru B2)
    if (!cur || ierNou || (r.nr === 1 && cur.nr_max > 1) || (r.nr <= 2 && r.nr < cur.prev && cur.nr_max > 2) || (pendinte.length > 0 && r.nr < cur.prev)) {
      inchideCur()
      cur = { de_la: r.offset, nr_min: r.nr, nr_max: r.nr, randuri: 0, pozitii: 0, goluri: [], goluri_ierarhice: [], reluari_atipice: 0,
        secventa_nedeterminata: pendinte.length > 0, nr_incerte: [...pendinte], vazute: new Set(), prev: r.nr, sub: new Map(), ultSub: new Map() }
    } else if ((r.nr < cur.prev && r.nr !== cur.prev) || ierAtipic) cur.reluari_atipice++
    cur.randuri++
    pendinte = []
    pendinteDeLa = -1
    cur.vazute.add(r.nr)
    if (r.nr_id && r.nr_id.includes('.')) {
      const c = r.nr_id.split('.')
      for (let k = 1; k < c.length; k++) {
        const par = c.slice(0, k).join('.'), ult = Number(c[k])
        if (!cur.sub.has(par)) cur.sub.set(par, new Set())
        cur.sub.get(par)!.add(ult)
        cur.ultSub.set(par, ult)
      }
    }
    cur.nr_min = Math.min(cur.nr_min, r.nr)
    cur.nr_max = Math.max(cur.nr_max, r.nr)
    cur.prev = r.nr
  }
  inchideCur()
  if (pendinte.length && !cur) {
    t.push({ de_la: pendinteDeLa, nr_min: Math.min(...pendinte), nr_max: Math.max(...pendinte), randuri: 0, pozitii: 0, goluri: [],
      goluri_ierarhice: [], reluari_atipice: 0, secventa_nedeterminata: true, nr_incerte: [...pendinte] })
  }
  return t
}

export function masoara(text: string): Masura {
  const r = inventarRanduri(text)
  const tb = tabele(r)
  const anc = r.filter((x) => x.stare === 'ancora')
  const perechi = new Set(anc.filter((x) => x.cod).map((x) => `${x.cod}|${x.cantitate}|${x.um}`))
  const dupa_pagina: Record<string, number> = {}
  for (const x of r) { const k = String(x.pagina ?? '-'); dupa_pagina[k] = (dupa_pagina[k] ?? 0) + 1 }
  return {
    randuri: r.length, ancore: anc.length, incerte: r.length - anc.length, ancore_cu_cod: anc.filter((x) => x.cod).length,
    perechi_distincte: perechi.size, tabele: tb.length, tabele_cu_goluri: tb.filter((x) => x.goluri.length || x.goluri_ierarhice.length).length,
    goluri: tb.reduce((s, x) => s + x.goluri.length + x.goluri_ierarhice.length, 0), reluari_atipice: tb.reduce((s, x) => s + x.reluari_atipice, 0),
    tabele_nedeterminate: tb.filter((x) => x.secventa_nedeterminata).length, dupa_pagina,
  }
}
