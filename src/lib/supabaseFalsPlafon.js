// Client Supabase FALS pentru teste (fără rețea): tabele în memorie + PLAFONUL PostgREST max-rows — cel mult 1000 de rânduri pe cerere, indiferent
// de .limit() (pe serverul real Content-Range 0-999). Fără .order() rândurile vin în ordinea „fizică” (ordinea tabloului), ca pe server, deci un cititor
// fără ordine și fără paginare primește un subset care depinde de ordinea tabloului (review #1158 r8). Înregistrează cererile (tabel, op, ordine, limită).
// Folosit de ActivitatiProiectPanel.test.jsx și verificariProiect.test.js; nu e cod de producție.
export const MAX_ROWS = 1000

// st = { tabele: { nume: rânduri[] }, cereri: [], erori: { nume: eroarePostgREST } }
export function creeazaClientFals(st) {
  return { from: tabel => constructor(st, tabel) }
}

const cmp = (x, y) => x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -1 : 1   // NULL la sfârșit, ca în PostgreSQL (ASC)

function constructor(st, tabel) {
  const q = { tabel, op: 'select', filtre: [], ordine: [], limita: null, unic: false }
  q.select = () => { q.op = 'select'; return q }
  q.eq = (c, v) => { q.filtre.push(r => r[c] === v); return q }
  q.neq = (c, v) => { q.filtre.push(r => r[c] !== v); return q }
  q.gt = (c, v) => { q.filtre.push(r => r[c] > v); return q }
  q.not = (c, op, v) => { if (op === 'is' && v === null) q.filtre.push(r => r[c] != null); return q }
  q.order = (c, o) => { q.ordine.push([c, o?.ascending !== false]); return q }
  q.limit = n => { q.limita = n; return q }
  q.maybeSingle = () => { q.unic = true; return q }
  for (const op of ['insert', 'update', 'delete']) q[op] = () => { q.op = op; return q }
  q.then = (res, rej) => {
    st.cereri.push({ tabel, op: q.op, ordine: q.ordine.map(o => o[0]), limita: q.limita })
    if (q.op !== 'select') return Promise.resolve({ data: null, error: { message: `clientul fals nu scrie (${q.op} pe ${tabel})` } }).then(res, rej)
    if (st.erori?.[tabel]) return Promise.resolve({ data: null, error: st.erori[tabel] }).then(res, rej)
    let rows = (st.tabele[tabel] || []).filter(r => q.filtre.every(f => f(r)))
    if (q.ordine.length) rows = [...rows].sort((a, b) => { for (const [c, asc] of q.ordine) { const s = cmp(a[c], b[c]); if (s) return asc ? s : -s } return 0 })
    rows = rows.slice(0, Math.min(q.limita ?? MAX_ROWS, MAX_ROWS)).map(r => ({ ...r }))
    return Promise.resolve({ data: q.unic ? (rows[0] ?? null) : rows, error: null }).then(res, rej)
  }
  return q
}
