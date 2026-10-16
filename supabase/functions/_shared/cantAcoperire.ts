// Val 2, PR-B1: completitudinea tabelelor de cantități — funcții pure, fără rețea. Azi „dovedit” spune doar că o valoare există în
// text; B1 numără ce AR TREBUI extras: rândurile-ancoră (rânduri numerotate / de tabel cu o cantitate cu UM real) și secvența nr. crt.
// pe fiecare tabel. B2 va compara rândurile extrase cu ancorele (acoperirea ancorelor) și va face tabelul „incomplet” la goluri.
// Aici: doar măsurarea textului (metrica de calitate a recitirii: ancore + perechi cod+cantitate distincte + goluri în nr. crt.).
import { identificatoriLinie, tokeniNumerici, umLanga } from './cantNumar.ts'

// unitățile reale (aceeași listă ca ancora din blocRand)
// + formele din devize: „TONA”, „M CUB” (cuvântul de lângă număr e „CUB”), „SUTE MC” (cuvântul e „MC”), „BUCATA”
export const UM_REALE = new Set(['m', 'mc', 'mp', 'km', 'buc', 'kg', 't', 'to', 'tona', 'tone', 'cub', 'bucata', 'bucati', 'l', 'set', 'ora', 'ore', 'h'])
// începutul unui rând numerotat: „003 SA11G1 …”, „12. Conducta …”, „**7** …”; la tabelul markdown nr. e prima celulă
const RE_NR_LISTA = /^\s*\**\s*(\d{1,4})[.)]?\**\s+\S/
const RE_NR_MARKDOWN = /^\s*\|?\s*\**\s*(\d{1,4})[.)]?\**\s*\|/
const RE_MARCAJ = /^⟦PAGINA\s*(\d{1,5})⟧/
const RE_TOTAL = /\btotal[ea]?\b/i
// un cod de deviz / material: litere + cifre (TRA01A50, SA11G1, 3A1iG1) sau ≥ 5 cifre (6701152); nu „DN90”, nu „PE100”, nu „SDR11”
const RE_COD = /^(?=.*\d)(?:[A-Z][A-Z0-9]{3,}|\d[A-Z0-9]*[A-Z][A-Z0-9]*|\d{5,})$/
const NU_COD = /^(?:DN|DE|PE|PN|SDR|PEHD|HDPE|OL|PVC|D)\d/

export type Ancora = { offset: number; pagina: number | null; nr: number | null; cod: string | null; cantitate: string; um: string; markdown: boolean }
export type Tabel = { de_la: number; nr_min: number; nr_max: number; randuri: number; goluri: number[]; markdown: boolean }
export type Masura = {
  ancore: number; ancore_cu_cod: number; perechi_distincte: number; tabele: number; tabele_cu_goluri: number; goluri: number
  reluari_atipice: number; dupa_pagina: Record<string, number>
}

function singurInCelula(linie: string, de: number, pana: number): boolean {
  // ultima celulă poate să nu aibă „|” de închidere („| 82 M CUB | 27,00000”)
  const st = linie.lastIndexOf('|', de - 1), dr0 = linie.indexOf('|', pana), dr = dr0 < 0 ? linie.length : dr0
  return st >= 0 && linie.slice(st + 1, de).trim() === '' && linie.slice(pana, dr).trim() === ''
}

function codDinLinie(linie: string): string | null {
  for (const id of identificatoriLinie(linie)) if (RE_COD.test(id) && !NU_COD.test(id)) return id
  return null
}

// rândurile-ancoră ale textului: un rând numerotat (listă) sau un rând de tabel markdown, cu cel puțin un token numeric cu UM real;
// rândurile de total / subtotal nu sunt ancore (nu sunt poziții). Cantitatea ancorei = primul token cu UM real de pe linie.
// rândurile de tabel markdown fără „|” de închidere („| M.C. | 0.19”) se închid pentru măsurare: altfel UM-ul din celula vecină nu
// trece de separator (umLanga cere ca tokenul să fie singur în celula lui, cu ambele margini). Offseturile ancorelor sunt în textul
// închis (inchideRanduri(text)) — B2 trebuie să folosească aceeași normalizare (sau umLanga să trateze sfârșitul liniei ca margine).
export const inchideRanduri = (text: string) =>
  text.split('\n').map((l) => (l.match(/\|/g) || []).length >= 2 && !/\|\s*$/.test(l) ? l + ' |' : l).join('\n')

export function ancoreRand(textBrut: string): Ancora[] {
  const text = inchideRanduri(textBrut)
  const out: Ancora[] = []
  let pagina: number | null = null, poz = 0
  for (const linie of text.split('\n')) {
    const start = poz
    poz += linie.length + 1
    const mp = RE_MARCAJ.exec(linie)
    if (mp) { pagina = Number(mp[1]); continue }
    const markdown = (linie.match(/\|/g) || []).length >= 2
    if (!markdown && !RE_NR_LISTA.test(linie)) continue
    if (/^\s*\|?\s*:?-{3,}/.test(linie)) continue
    // nu sunt cantități, deși pot fi urmate de UM: „[ 2]” din lista F3 (indicele articolului, „003 SA11G1 [ 2] M 1160.000”) și
    // codul numeric al materialului („003 6701152 M 1160.000”)
    const cod = codDinLinie(linie)
    const cuUm = tokeniNumerici(linie, start).filter((t) => !/\[\s*$/.test(linie.slice(0, t.de_la - start)) && t.text !== cod &&
      [...umLanga(text, t.de_la, t.pana_la)].some((u) => UM_REALE.has(u)))
    // în tabel, cantitatea e tokenul SINGUR în celula lui („82 M CUB | 52,93800 |” → 52,938, nu capitolul 82); altfel primul token
    const tok = cuUm.find((t) => markdown && singurInCelula(linie, t.de_la - start, t.pana_la - start)) ?? cuUm[0]
    if (!tok) continue
    // rând de total / subtotal: „total” ÎNAINTEA cantității („Total conducte 120 m”); „… 0.000 0 Total=” după articol nu e total
    if (RE_TOTAL.test(linie.slice(0, tok.de_la - start))) continue
    const um = [...umLanga(text, tok.de_la, tok.pana_la)].find((u) => UM_REALE.has(u))!
    const mn = (markdown ? RE_NR_MARKDOWN : RE_NR_LISTA).exec(linie)
    // nr. crt. = primul număr al rândului, doar dacă nu e chiar cantitatea
    const nr = mn && !(mn.index + mn[0].indexOf(mn[1]) + start === tok.de_la) ? Number(mn[1]) : null
    out.push({ offset: start, pagina, nr, cod, cantitate: tok.text, um, markdown })
  }
  return out
}

// tabelele = șirurile de ancore numerotate; un tabel nou începe când nr. scade (reluare de la 1 = normal, altfel „atipică”) sau când
// se schimbă felul rândului (listă ↔ markdown). Nr. repetat (rândul de material „003 6701152” sub „003 SA11G1”) e același articol.
// Golurile = numerele lipsă între nr. consecutive ale aceluiași tabel. Ancorele fără nr. nu intră în secvență.
export function tabele(ancore: Ancora[]): { tabele: Tabel[]; reluari_atipice: number } {
  const t: Tabel[] = []
  let cur: Tabel | null = null, prev = 0, atipice = 0
  for (const a of ancore) {
    if (a.nr === null) continue
    if (!cur || a.markdown !== cur.markdown || a.nr < prev) {
      if (cur && a.nr !== 1 && a.markdown === cur.markdown) atipice++
      cur = { de_la: a.offset, nr_min: a.nr, nr_max: a.nr, randuri: 0, goluri: [], markdown: a.markdown }
      t.push(cur)
    } else if (a.nr > prev + 1) {
      for (let k = prev + 1; k < a.nr && cur.goluri.length < 200; k++) cur.goluri.push(k)
    }
    cur.randuri++
    cur.nr_max = Math.max(cur.nr_max, a.nr)
    prev = a.nr
  }
  return { tabele: t, reluari_atipice: atipice }
}

export function masoara(text: string): Masura {
  const a = ancoreRand(text)
  const { tabele: tb, reluari_atipice } = tabele(a)
  const perechi = new Set(a.filter((x) => x.cod).map((x) => `${x.cod}|${x.cantitate}|${x.um}`))
  const dupa_pagina: Record<string, number> = {}
  for (const x of a) { const k = String(x.pagina ?? '-'); dupa_pagina[k] = (dupa_pagina[k] ?? 0) + 1 }
  return {
    ancore: a.length, ancore_cu_cod: a.filter((x) => x.cod).length, perechi_distincte: perechi.size,
    tabele: tb.length, tabele_cu_goluri: tb.filter((x) => x.goluri.length).length, goluri: tb.reduce((s, x) => s + x.goluri.length, 0),
    reluari_atipice, dupa_pagina,
  }
}

