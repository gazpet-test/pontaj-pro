// diurneOrdin.js — câte zile intră pe ordinul de deplasare generat dintr-o plată (openOrdGen).
// Decizia Răzvan 01.10.2026 (3A): min(zileDiurna din alocaDiurneTransa, zile NET de pe ordin) —
// aceeași alocare ca la export, plată și BT (scade CO, numără weekendul, împarte tranșele lunii).
export function zileOrdinDeplasare(alocareEmp, netDaysCount) {
  const z = Number(alocareEmp?.zileDiurna) || 0
  return Math.max(0, Math.min(z, Number(netDaysCount) || 0))
}

// ── Poarta de dată pentru ordinele de deplasare (regula Marilenei, decizie Răzvan 13.10.2026) ──
// Ordinele pentru o lună se pot genera doar de pe 16 a lunii următoare (statul de plată definitiv
// se face pe 15). Fără termen de final. Înlocuiește fereastra veche (ultima zi / 1–7 ale lunii următoare).
export const ZI_GENERARE_ORDINE = 16

// Prima zi în care se pot genera ordinele pentru luna lui periodFrom ('YYYY-MM-DD').
export function dataMinimaGenerareOrdin(periodFrom) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(periodFrom || ''))) return null
  const [y, m] = periodFrom.slice(0, 7).split('-').map(Number)
  if (m < 1 || m > 12) return null   // lună imposibilă (Copilot P1-3)
  return new Date(y, m, ZI_GENERARE_ORDINE)   // luna m (1-based) = luna următoare în Date (0-based)
}

// azi (Date) ≥ ziua 16 a lunii următoare? Comparăm pe zile calendaristice locale, nu pe oră.
export function poateGeneraOrdin(periodFrom, azi = new Date()) {
  const min = dataMinimaGenerareOrdin(periodFrom)
  if (!min) return false
  const a = new Date(azi.getFullYear(), azi.getMonth(), azi.getDate())
  return a >= min
}

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const fmtZi = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`

// Textul afișat când generarea e blocată.
export function motivBlocareOrdin(periodFrom) {
  const min = dataMinimaGenerareOrdin(periodFrom)
  if (!min) return 'Perioadă invalidă.'
  const [y, m] = periodFrom.slice(0, 7).split('-').map(Number)
  return `Ordinele pentru ${LUNI[m - 1]} ${y} se pot genera de pe ${fmtZi(min)} — statul de plată definitiv se face pe 15.`
}
