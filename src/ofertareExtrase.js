// Fișierele extrase din arhive („<arhivă> (#<id>)/…”, workerul de pe Terra) NU sunt comunicări ale autorității: în listele
// „📥 Primite de la autoritate” (Clarificări) și „Documente noi din SEAP” rămâne ARHIVA, cu un rezumat al conținutului, plus
// extrasele care sunt ele însele răspunsuri la clarificări. Restul se lucrează din Documentație. Mânăstirea (05.10.2026):
// 159 de formulare / liste / planșe dintr-un RAR umpleau lista de 182 de rânduri (aparut_ulterior se moștenește de la arhivă,
// iar listele filtrează pe el, nu pe tip — review 07.10, PR #641). Logică pură, testată în ofertareExtrase.test.js.
import { DIN_ARHIVA_RE } from './ofertareTermene.js'

export const esteExtras = (d) => DIN_ARHIVA_RE.test(d?.nume_original || '')

/** Ce se afișează în listele „primite”: tot ce nu e extras din arhivă + extrasele de tip răspuns la clarificare. */
export const primiteVizibile = (docs) => (docs || []).filter(d => d && (!esteExtras(d) || d.tip === 'raspuns_clarificare'))

const ETICHETA = { formular: 'formulare', lista_cantitati: 'liste de cantități', plansa: 'planșe', cs_volum: 'caiete / volume',
  fisa_date: 'fișe de date', model_contract: 'modele de contract', raspuns_clarificare: 'răspunsuri', alta: 'alte' }

/** Fișierele extrase (la orice adâncime) din arhiva cu id-ul dat, numărate pe tip; null dacă nu e niciunul. */
export function rezumatExtrase(arhivaId, docs) {
  const re = new RegExp(` \\(#${Number(arhivaId)}\\)[/_]`)
  const peTip = {}
  let n = 0
  for (const d of docs || []) {
    if (!d || !re.test(d.nume_original || '')) continue
    n++; peTip[d.tip || 'alta'] = (peTip[d.tip || 'alta'] || 0) + 1
  }
  if (!n) return null
  const parti = Object.entries(peTip).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, k]) => `${k} ${ETICHETA[t] || t}`)
  return { n, peTip, text: `📦 ${n} fișiere extrase din arhivă: ${parti.join(', ')} — sunt în Documentație` }
}
