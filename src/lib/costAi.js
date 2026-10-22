// Aceeași estimare ca în Administrativ.jsx, unde constanta nu este exportată.
export const USD_TO_RON = 5.0

const numeric = value => {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) throw new Error('Valoare numerică invalidă în raportul Cost AI.')
  return n
}
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && value.slice(0, 4) !== '0000'

export function monthRange(de, pana) {
  if (!validMonth(de) || !validMonth(pana) || de > pana) throw new Error('Alege un interval de luni valid.')
  return { p_de: `${de}-01`, p_pana: `${pana}-01` }
}

export function defaultMonths(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find(p => p.type === 'year').value)
  const month = Number(parts.find(p => p.type === 'month').value)
  const first = new Date(Date.UTC(year, month - 3, 1))
  return { de: first.toISOString().slice(0, 7), pana: `${year}-${String(month).padStart(2, '0')}` }
}

export function formatMoney(value, currency = 'USD') {
  return `${numeric(value).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: currency === 'USD' ? 4 : 2 })} ${currency}`
}

export function formatMonth(value) {
  const month = String(value).slice(0, 7)
  if (!validMonth(month)) return 'Lună necunoscută'
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', timeZone: 'Europe/Bucharest' })
}

// Cheile includ tipul și ID-ul; două ținte cu același nume nu se contopesc.
export function groupCosts(rows = []) {
  const monthly = new Map(), modules = new Map(), targets = new Map()
  const total = { cost_usd: 0, apeluri: 0, rezervat_in_curs_usd: 0 }
  const add = (map, key, label, row) => {
    if (!map.has(key)) map.set(key, { ...label, cost_usd: 0, apeluri: 0, rezervat_in_curs_usd: 0 })
    const item = map.get(key)
    for (const field of Object.keys(total)) item[field] += row[field]
  }
  for (const input of rows) {
    const row = { ...input, cost_usd: numeric(input.cost_usd), apeluri: numeric(input.apeluri), rezervat_in_curs_usd: numeric(input.rezervat_in_curs_usd) }
    const modul = row.modul || 'Altele'
    const targeted = ['proiect', 'licitatie'].includes(row.tip_tinta) && row.tinta_id != null
    const targetKey = targeted ? [row.tip_tinta, String(row.tinta_id)] : ['fara', modul]
    const nume = targeted ? row.tinta_nume || `${row.tip_tinta === 'proiect' ? 'Proiect' : 'Licitația'} #${row.tinta_id}` : `Fara proiect - ${modul}`
    for (const field of Object.keys(total)) total[field] += row[field]
    add(monthly, JSON.stringify([row.luna, ...targetKey, modul]), { luna: row.luna, nume, modul, tip_tinta: row.tip_tinta, tinta_id: row.tinta_id }, row)
    add(modules, modul, { nume: modul }, row)
    if (targeted) add(targets, JSON.stringify(targetKey), { nume, tip_tinta: row.tip_tinta, tinta_id: row.tinta_id }, row)
  }
  const byCost = (a, b) => b.cost_usd - a.cost_usd || a.nume.localeCompare(b.nume, 'ro') || String(a.tinta_id).localeCompare(String(b.tinta_id))
  return {
    total,
    monthly: [...monthly.values()].sort((a, b) => b.luna.localeCompare(a.luna) || a.nume.localeCompare(b.nume, 'ro') || a.modul.localeCompare(b.modul, 'ro') || String(a.tinta_id).localeCompare(String(b.tinta_id))),
    modules: [...modules.values()].sort(byCost),
    top: [...targets.values()].filter(r => r.apeluri > 0).sort(byCost).slice(0, 10),
  }
}
