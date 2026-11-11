// Logistică / Transporturi — reguli pure folosite de lista din tab-ul Transporturi și de bannerul
// „Transporturi blocate” de pe Active (TKT-2026-0356). O singură definiție pentru „blocat” (L19).
// Datele sunt șiruri 'AAAA-LL-ZZ'; „azi” îl calculează apelantul în Europe/Bucharest (ziBucuresti).

// Statusuri „încă deschise”: transportul n-a plecat (aprobat / programat — „programat” e statusul
// vechi, afișat tot ca „aprobat”) sau a plecat și livrarea nu e confirmată (in_tranzit).
export const STATUS_NEPLECAT = ['aprobat', 'programat']
export const STATUS_DESCHIS = [...STATUS_NEPLECAT, 'in_tranzit']

// Valoarea specială a filtrului de status: exact transporturile din banner.
export const FILTRU_BLOCATE = 'blocate'

const ZI = /^\d{4}-\d{2}-\d{2}$/
const zi = v => (typeof v === 'string' && ZI.test(v.slice(0, 10)) ? v.slice(0, 10) : null)

// Ziua 'AAAA-LL-ZZ' deplasată cu n zile (calendaristic, fără fus orar).
export function adunaZile(ziua, n) {
  const z = zi(ziua)
  if (!z) return null
  const [y, m, d] = z.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Blocat = aprobat/programat cu data planificată trecută (n-a plecat), sau în tranzit cu data
// depășită cu cel puțin o zi (livrare neconfirmată). Fără dată = nu se poate spune → nu e blocat.
export function esteTransportBlocat(t, azi) {
  const data = zi(t?.data_transport), z = zi(azi)
  if (!data || !z) return false
  if (STATUS_NEPLECAT.includes(t.status)) return data < z
  if (t.status === 'in_tranzit') return data < adunaZile(z, -1)
  return false
}

// Intervalul filtrului de perioadă: { start, end } (end null = deschis); 'tot' = fără limite.
export function intervalPerioada(perioada, azi) {
  const z = zi(azi)
  if (!z || perioada === 'tot') return { start: null, end: null }
  if (perioada === 'azi') return { start: z, end: z }
  if (perioada === 'sapt') return { start: adunaZile(z, -7), end: null }
  if (perioada === 'luna') return { start: z.slice(0, 8) + '01', end: null }
  return { start: null, end: null }
}

// Un transport încă deschis, planificat ÎNAINTEA perioadei afișate, rămâne în listă până pleacă /
// e livrat / e anulat: filtrul implicit „Luna” nu are voie să ascundă un transport aprobat vechi.
// Pentru 'tot' nu e nevoie (start null) — lista le are deja pe toate.
export function esteDeschisDinainte(t, start) {
  const data = zi(t?.data_transport)
  return !!start && !!data && data < start && STATUS_DESCHIS.includes(t.status)
}

// Același criteriu, ca filtru client pentru o listă deja încărcată (paritate cu interogările).
export function inPerioadaSauDeschis(t, { start, end }) {
  if (!start && !end) return true
  const data = zi(t?.data_transport)
  if (data && (!start || data >= start) && (!end || data <= end)) return true
  return esteDeschisDinainte(t, start)
}

// Reunește rezultatele celor două interogări (perioada + deschise dinainte), fără dubluri pe id.
export function reunesteTransporturi(...liste) {
  const vazut = new Map()
  for (const lista of liste) for (const t of lista || []) if (t && !vazut.has(t.id)) vazut.set(t.id, t)
  return Array.from(vazut.values())
}

// Lista afișată: filtrul de status (inclusiv „blocate”) + ordinea.
// Aprobate / blocate: cele mai vechi sus (cele mai urgente); altfel cele mai recente sus.
export function filtreazaTransporturi(lista, statusFilter, azi) {
  let r = [...(lista || [])]
  if (statusFilter === FILTRU_BLOCATE) r = r.filter(t => esteTransportBlocat(t, azi))
  else if (statusFilter === 'aprobat') r = r.filter(t => STATUS_NEPLECAT.includes(t.status))
  else if (statusFilter !== 'Toate') r = r.filter(t => t.status === statusFilter)
  const urcator = statusFilter === 'aprobat' || statusFilter === 'programat' || statusFilter === FILTRU_BLOCATE
  // Transporturile fără dată stau la final în ambele ordini.
  r.sort((a, b) => {
    const da = a.data_transport || '', db = b.data_transport || ''
    if (!da !== !db) return da ? -1 : 1
    return urcator ? (da.localeCompare(db) || (a.id - b.id)) : (db.localeCompare(da) || (b.id - a.id))
  })
  return r
}
