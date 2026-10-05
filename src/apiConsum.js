// Consumul abonamentelor externe (Administrativ › Costuri AI) — logică pură, testată în apiConsum.test.js.
// Datele vin din public.api_consum_extern / v_api_consum_curent (migrarea 20261014a), scrise de edge-ul api-consum-extern
// (sursa 'api') și de rutina zilnică Claude (sursa 'rutina_claude', ex. Desktop Commander). Fără intrări de mână.

export const FURNIZORI_UI = {
  firecrawl:         { icon: '🔥', nume: 'Firecrawl', unitate: 'credite', descriere: 'cercetare web din sesiunile Claude (MCP)' },
  desktop_commander: { icon: '🖥', nume: 'Desktop Commander', unitate: 'procent', descriere: 'cota lunară de apeluri Remote MCP' },
}
// Furnizorii afișați chiar și fără nicio citire (valul 1); restul apar când au primul rând.
export const FURNIZORI_ASTEPTATI = ['firecrawl', 'desktop_commander']

export const fmtZi = zi => (zi ? String(zi).slice(0, 10).split('-').reverse().join('.') : '—')
export const fmtOra = ts => (ts ? new Date(ts).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
export const fmtNr = n => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 2 }))

// Procentul rămas din plan (0–100) sau null când nu se poate calcula
export function procentRamas(plan, ramase) {
  const p = Number(plan), r = Number(ramase)
  if (plan == null || ramase == null || !Number.isFinite(p) || !Number.isFinite(r) || p <= 0) return null
  return Math.max(0, Math.min(100, (r / p) * 100))
}

// „AAAA-LL-ZZ” + n zile (aritmetică pe UTC, fără surprize de DST)
export function plusZile(zi, n) {
  if (!zi || n == null || !Number.isFinite(Number(n))) return null
  const [y, m, d] = String(zi).slice(0, 10).split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + Number(n) * 86400000
  return Number.isFinite(t) && Math.abs(t) < 8.64e15 ? new Date(t).toISOString().slice(0, 10) : null
}

// Data estimată a epuizării, din rândul view-ului; `inainteDeReset` = se termină înainte de sfârșitul perioadei
export function epuizare(v) {
  if (!v || v.zile_pana_la_epuizare == null || !v.zi) return null
  const data = plusZile(v.zi, v.zile_pana_la_epuizare)
  if (!data) return null
  return { data, inainteDeReset: v.perioada_sfarsit ? data <= String(v.perioada_sfarsit).slice(0, 10) : null }
}

// Consumul pe zi din citirile zilnice ale UNUI furnizor (credite rămase azi vs ieri, în aceeași perioadă de facturare).
// Rămase în creștere sau perioadă nouă → 'reset' (nu consum negativ). Contează doar citirea bună a zilei (credite_ramase);
// o eroare din aceeași zi stă în coloanele ei (eroare, eroare_la) și nu anulează citirea (20261014a r2).
export function consumZilnic(randuri) {
  const bune = (randuri || []).filter(r => r && r.credite_ramase != null)
    .slice().sort((a, b) => (a.zi < b.zi ? -1 : a.zi > b.zi ? 1 : 0))
  const out = []
  for (let i = 0; i < bune.length; i++) {
    const r = bune[i], prev = bune[i - 1]
    let consum = null, reset = false
    if (prev) {
      const aceeasiPerioada = (prev.perioada_start || null) === (r.perioada_start || null)
      const dif = Number(prev.credite_ramase) - Number(r.credite_ramase)
      if (!aceeasiPerioada || dif < 0) reset = true
      else consum = dif
    }
    out.push({ zi: r.zi, ramase: Number(r.credite_ramase), plan: r.credite_plan == null ? null : Number(r.credite_plan), consum, reset })
  }
  return out
}

// Lista de carduri: furnizorii din view + cei așteptați fără citiri (ordine stabilă: așteptații întâi, apoi alfabetic)
export function carduri(randuriView) {
  const peF = new Map((randuriView || []).map(v => [v.furnizor, v]))
  const nume = [...new Set([...FURNIZORI_ASTEPTATI, ...peF.keys()])]
  return nume.map(f => ({ furnizor: f, v: peF.get(f) || null, ui: FURNIZORI_UI[f] || { icon: '🔌', nume: f, unitate: '', descriere: '' } }))
}

// Ultima eroare a furnizorului, din rândul view-ului: `curenta` = e mai nouă decât ultima citire bună (ultima încercare a eșuat)
export function stareEroare(v) {
  if (!v || !v.ultima_eroare) return null
  return { text: v.ultima_eroare, la: v.ultima_eroare_la || null, curenta: v.eroare_dupa_citire === true || v.citit_la == null }
}
