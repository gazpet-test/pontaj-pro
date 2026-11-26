// Cititorul UNIC al fixturii din testul Jilava (docs/ofertare/grafic_automat_test_jilava/grafic_Y_ai.txt), folosit și de
// regresia vitest (src/graficMotor/jilavaRegresie.test.js), și de scripts/grafic/genereaza_mspdi_proba.mjs — ca probele să nu
// citească fixtura în două feluri (r1 Jak: L13/L19). Totul e strict: un rând sau un predecesor neînțeles OPREȘTE citirea.
// Regexul predecesorului e cel din cpm.py (ancorat la ambele capete): „4.3 FS+2ore” sau „4.3 FS+2z REST” sunt refuzate.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DOVEZI_JILAVA = fileURLToPath(new URL('../../docs/ofertare/grafic_automat_test_jilava/', import.meta.url))
export const ANTET_Y = 'WBS | rezumat | jalon | denumire | executant | durata_zile_lucratoare | sursa_durata | start | finish | predecesori (WBS tip+lag)'
export const RE_PREDECESOR = /^\s*([0-9][0-9.]*)\s+(FS|SS|FF|SF)\s*([+-]\s*\d+)?\s*z?\s*$/

export function liniiFisier(nume, dosar = DOVEZI_JILAVA) {
  return readFileSync(dosar + nume, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
}

export function parseazaPredecesori(txt, wbs) {
  if (!txt || txt === '-') return []
  return txt.split(';').map(s => s.trim()).filter(Boolean).map(p => {
    const m = RE_PREDECESOR.exec(p)
    if (!m) throw new Error(`${wbs}: predecesor neînțeles: ${JSON.stringify(p)}`)
    return { de: m[1], tip: m[2], lag_zile: m[3] ? Number(m[3].replace(/\s/g, '')) : 0 }
  })
}

// → { randuri (coloanele brute, pentru comparații), activitati, legaturi } în formatul de intrare al calculeazaGrafic
export function citesteGraficY(dosar = DOVEZI_JILAVA) {
  const [antet, ...linii] = liniiFisier('grafic_Y_ai.txt', dosar)
  if (antet.trim() !== ANTET_Y) throw new Error('antet neașteptat în grafic_Y_ai.txt')
  const randuri = linii.map(l => {
    let c = l.replace(/\s*\|\s*$/, '').split(' | ').map(x => x.trim())
    if (c.length === 9) c = [...c, '-']
    if (c.length !== 10) throw new Error(`rând cu ${c.length} coloane: ${l}`)
    if (!['da', 'nu'].includes(c[1]) || !['da', 'nu'].includes(c[2])) throw new Error(`${c[0]}: rezumat/jalon trebuie „da”/„nu”`)
    if (c[1] === 'nu' && !/^\d+$/.test(c[5])) throw new Error(`${c[0]}: durată neîntreagă ${JSON.stringify(c[5])}`)
    return { wbs: c[0], rezumat: c[1] === 'da', jalon: c[2] === 'da', den: c[3], exec: c[4], dur: c[5], sursa: c[6], start: c[7], final: c[8], pred: c[9] }
  })
  const coduri = new Set(randuri.map(r => r.wbs))
  const parinte = (w) => { if (w === '0') return null; const i = w.lastIndexOf('.'); const p = i < 0 ? '0' : w.slice(0, i); return coduri.has(p) ? p : null }
  const activitati = randuri.map(r => ({
    cod: r.wbs, parinte: parinte(r.wbs), rezumat: r.rezumat, jalon: r.jalon, denumire: r.den, executant: r.exec,
    ...(r.rezumat ? {} : { durata_zile_lucratoare: Number(r.dur), sursa_durata: r.sursa, categorie: r.jalon ? 'jalon' : 'executie' }),
  }))
  const legaturi = randuri.filter(r => !r.rezumat).flatMap(r => parseazaPredecesori(r.pred, r.wbs).map(p => ({ ...p, la: r.wbs })))
  return { randuri, activitati, legaturi }
}
