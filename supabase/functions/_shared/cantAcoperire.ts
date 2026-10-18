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
const RE_NR_LISTA = /^\s*\**\s*(\d{1,4})\**[.)]?\**\s+\S/
const RE_NR_MARKDOWN = /^\s*\|?\s*\**\s*(\d{1,4})(?:\.\d{1,3})*\**[.)]?\**\s*\|/
const RE_MARCAJ = /^⟦PAGINA\s*(\d{1,5})⟧/
const RE_SEPARATOR = /^\s*\|?\s*:?-{3,}/
// cantitate cu separator de mii prin spațiu („1 234,50”, „2 450,00”) — tokenizarea o rupe; rândul devine „incert”, nu dispare
const RE_MII_SPATIU = /(?<![\d.,])\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?(?![\d.,])/
// un cod de deviz / material: litere + cifre (TRA01A50, SA11G1, 3A1iG1) sau ≥ 5 cifre (6701152); nu „DN90”, nu „PE100”, nu „SDR11”
const RE_COD = /^(?=.*\d)(?:[A-Z][A-Z0-9]{3,}|\d[A-Z0-9]*[A-Z][A-Z0-9]*|\d{5,})$/
const NU_COD = /^(?:DN|DE|PE|PN|SDR|PEHD|HDPE|OL|PVC|D)\d/

export type Stare = 'ancora' | 'incert'
export type RandInventar = {
  offset: number            // începutul liniei rândului în textul ORIGINAL
  linie: number             // numărul liniei (1-based) în textul original
  pagina: number | null
  nr: number | null        // nr. crt. (≥ 1); null = rând de tabel fără coloană de numerotare, cu cod (C6) — nu intră în secvență
  cod: string | null        // codul de după nr. (după POZIȚIE, nu după egalitate textuală)
  cantitate: string | null
  um: string | null
  markdown: boolean
  stare: Stare
  motiv: string | null      // de ce e „incert”
}
export type Tabel = { de_la: number; nr_min: number; nr_max: number; randuri: number; pozitii: number; goluri: number[]; reluari_atipice: number }
export type Masura = {
  randuri: number; ancore: number; incerte: number; ancore_cu_cod: number; perechi_distincte: number
  tabele: number; tabele_cu_goluri: number; goluri: number; reluari_atipice: number; dupa_pagina: Record<string, number>
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
function nrRand(l: string): { nr: number; dupa: number; markdown: boolean } | null {
  if (RE_SEPARATOR.test(l)) return null
  const markdown = (l.match(/\|/g) || []).length >= 2
  const m = (markdown ? RE_NR_MARKDOWN : RE_NR_LISTA).exec(l)
  if (!m) return null
  const nr = Number(m[1])
  if (!(nr >= 1)) return null
  // rândul de numerotare a coloanelor sub antet („0 | 1 | 2 | 3 …”, „1 | 2 | 3 | 4”) nu e un rând
  if (markdown && /^[\s|]*\d{1,2}(?:\s*\|\s*\d{1,2}){2,}[\s|]*$/.test(l)) return null
  return { nr, dupa: m.index + m[0].length - (markdown ? 0 : 1), markdown }
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

export function inventarRanduri(text: string): RandInventar[] {
  const orig = text.split('\n')
  const inch = orig.map(inchide)
  const t = inch.join('\n')
  const out: RandInventar[] = []
  let pagina: number | null = null, po = 0, pi = 0
  for (let i = 0; i < orig.length; i++) {
    const lo = orig[i], li = inch[i]
    const startO = po, startI = pi
    po += lo.length + 1; pi += li.length + 1
    const mp = RE_MARCAJ.exec(lo)
    if (mp) { pagina = Number(mp[1]); continue }
    let r: { nr: number | null; dupa: number; markdown: boolean } | null = nrRand(li)
    // rând de tabel FĂRĂ nr. (C6 doar cu cod de resursă): intră în inventar dacă prima celulă e un cod — altfel un tabel nenumerotat
    // ar avea inventar gol și ar ascunde orice omisiune (review r1)
    if (!r && (li.match(/\|/g) || []).length >= 2 && !RE_SEPARATOR.test(li) && codDupaNr(li).cod) r = { nr: null, dupa: 0, markdown: true }
    if (!r) continue
    const rest = li.slice(r.dupa)
    const c = codDupaNr(rest)
    const nrSpan: [number, number] = [0, r.dupa]
    const excluse: [number, number][] = [nrSpan, ...(c.cod ? [[r.dupa + c.de, r.dupa + c.pana] as [number, number]] : [])]
    let cu = cantitateSiUm(t, startI, li, excluse, r.markdown)
    let motiv: string | null = null
    if (!cu && RE_MII_SPATIU.test(rest)) motiv = 'separator_mii_spatiu'
    // cantitatea / UM pe linia următoare („1 Conducta PEHD” / „m 120,000”), dacă aceea nu e un rând nou
    if (!cu && !motiv && i + 1 < orig.length && !nrRand(inch[i + 1]) && !RE_MARCAJ.test(orig[i + 1])) {
      const urm = cantitateSiUm(t, startI + li.length + 1, inch[i + 1], [], (inch[i + 1].match(/\|/g) || []).length >= 2)
      if (urm) { cu = urm; motiv = null }
    }
    // în LISTĂ (fără „|”), o linie care începe cu un număr e un rând doar dacă după nr. vine un cod SAU are o cantitate (pe linie
    // sau pe linia următoare): altfel continuările de denumire („2 COD 64000115”, „1X 1,5 U NID”) ar umfla inventarul. În TABEL
    // (≥ 2 „|”) orice rând numerotat intră.
    if (!r.markdown && !c.cod && !cu && !motiv) continue
    if (!cu && !motiv) motiv = 'um_sau_cantitate_nerecunoscute'
    out.push({ offset: startO, linie: i + 1, pagina, nr: r.nr, cod: c.cod, cantitate: cu?.cantitate ?? null, um: cu?.um ?? null,
      markdown: r.markdown, stare: cu ? 'ancora' : 'incert', motiv: cu ? null : motiv })
  }
  return out
}

// tabelele = șiruri de rânduri numerotate; un tabel nou începe DOAR la reluarea de la 1 (după un nr. > 1). Formatul (listă / tabel) NU
// separă tabelele (review r1: altfel o schimbare de format ascundea un gol). Un nr. care scade fără să fie 1 (suprapunere de pagină,
// rând de material) = „reluare atipică”, în același tabel. Golurile = numerele dintre min și max care nu apar deloc în tabel.
export function tabele(randuri: RandInventar[]): Tabel[] {
  const t: Tabel[] = []
  let cur: (Tabel & { vazute: Set<number>; prev: number }) | null = null
  const inchideCur = () => {
    if (!cur) return
    for (let k = cur.nr_min; k <= cur.nr_max && cur.goluri.length < 200; k++) if (!cur.vazute.has(k)) cur.goluri.push(k)
    cur.pozitii = cur.vazute.size
    const { vazute: _v, prev: _p, ...tb } = cur
    t.push(tb)
  }
  for (const r of randuri) {
    if (r.nr === null) continue
    if (!cur || (r.nr === 1 && cur.nr_max > 1 && cur.vazute.has(1))) {
      inchideCur()
      cur = { de_la: r.offset, nr_min: r.nr, nr_max: r.nr, randuri: 0, pozitii: 0, goluri: [], reluari_atipice: 0, vazute: new Set(), prev: r.nr }
    } else if (r.nr < cur.prev && r.nr !== cur.prev) cur.reluari_atipice++
    cur.randuri++
    cur.vazute.add(r.nr)
    cur.nr_min = Math.min(cur.nr_min, r.nr)
    cur.nr_max = Math.max(cur.nr_max, r.nr)
    cur.prev = r.nr
  }
  inchideCur()
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
    perechi_distincte: perechi.size, tabele: tb.length, tabele_cu_goluri: tb.filter((x) => x.goluri.length).length,
    goluri: tb.reduce((s, x) => s + x.goluri.length, 0), reluari_atipice: tb.reduce((s, x) => s + x.reluari_atipice, 0), dupa_pagina,
  }
}
