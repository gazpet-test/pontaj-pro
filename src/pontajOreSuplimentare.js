// TKT-2026-0316 (Natalia, 02.10.2026): ORE SUPLIMENTARE din Pontaj Brut = TOTAL ORE LUNĂ − ORELE LUCRĂTOARE ale angajatului.
// Orele lucrătoare țin cont de norma redusă (employees.procent_ocupare: 100 / 50 / 25 → 8 / 4 / 2 h/zi) și de luna
// incompletă (zilele lucrătoare dinainte de hire_date sau de după termination_date nu se socotesc).
// Zi lucrătoare = luni–vineri, fără sărbătorile legale (aceeași regulă ca „Zile lucr. lună" din export).

const pad = (n) => String(n).padStart(2, '0')

// Ore de normă pe zi: 8 × procent / 100; procent lipsă / invalid → normă întreagă (8h)
export function oreNormaPeZi(procentOcupare) {
  const p = Number(procentOcupare)
  if (!Number.isFinite(p) || p <= 0 || p > 100) return 8
  return 8 * p / 100
}

// Zilele lucrătoare ale lunii în care angajatul era în contract (inclusiv ziua angajării și ziua încetării)
export function zileLucratoareAngajat({ y, m, days, legalSet, hireDate, terminationDate }) {
  let n = 0
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m)}-${pad(d)}`
    const zi = new Date(y, m - 1, d).getDay()
    if (zi === 0 || zi === 6 || legalSet.has(ds)) continue
    if (hireDate && ds < hireDate) continue
    if (terminationDate && ds > terminationDate) continue
    n++
  }
  return n
}

export function oreLucratoareAngajat({ y, m, days, legalSet, emp }) {
  const zile = zileLucratoareAngajat({ y, m, days, legalSet, hireDate: emp?.hire_date || null, terminationDate: emp?.termination_date || null })
  return +(zile * oreNormaPeZi(emp?.procent_ocupare)).toFixed(2)
}

export const oreSuplimentare = (totalOreLuna, oreLucratoare) => +Math.max(0, totalOreLuna - oreLucratoare).toFixed(2)
