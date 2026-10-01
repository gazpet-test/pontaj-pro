// ════════════════════════════════════════════════════════════════
// diurneAlocare.js — alocarea diurnelor unei tranșe pe plafonul LUNAR al fiecărui angajat.
//
// Regula de business (Răzvan, 30.09.2026; verificare read-only pe septembrie 2026 în
// docs/DIURNE_VERIFICARE_SEPT_2026.md, verdict Copilot GO pe formula comună):
//   pentru fiecare angajat și fiecare LUNĂ calendaristică
//     C = max(0, zile lucrătoare ale lunii (L–V minus sărbători legale din calendar_days)
//                − zile cu norma 'CO' pe zile lucrătoare)         ← DOAR CO; LL/CM/BO nu scad
//     B = zile DISTINCTE cu diurna=true din aceeași lună, ANTERIOARE tranșei (toate zilele, și weekend)
//     N = zile distincte cu diurna=true în tranșă
//     zile_diurnă = min(C, B+N) − min(C, B);  zile_salariu = N − zile_diurnă;  sume × diurna_amount
//   Fără plafon separat pe zilele lucrătoare ale tranșei. O tranșă care trece peste 1 ale lunii se
//   calculează pe segmente lunare și se însumează. O zi pe mai multe șantiere = o singură zi.
//
// Aceeași funcție e folosită de exportDiurne (Excel), savePayment (ce se salvează în
// diurna_payment_details) și exportBancaDiurne (BT) — ca cele trei să nu mai calculeze lucruri diferite.
// Pur, fără Supabase: primește înregistrările de pontaj ale lunii/lunilor și setul de sărbători legale.
// ════════════════════════════════════════════════════════════════

const pad2 = n => String(n).padStart(2, '0')

export function lunaDin(iso) { return iso.slice(0, 7) }                       // '2026-09-15' → '2026-09'
export function inceputLuna(iso) { return iso.slice(0, 7) + '-01' }
export function sfarsitLuna(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return `${y}-${pad2(m)}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
export function ziUrmatoare(iso) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
export function esteZiLucratoare(iso, legalSet) {
  const wd = new Date(iso + 'T00:00:00Z').getUTCDay()
  return wd !== 0 && wd !== 6 && !(legalSet && legalSet.has(iso))
}
// Zilele lucrătoare ale lunii care conține `iso` (L–V minus sărbători legale)
export function zileLucratoareLuna(iso, legalSet) {
  const out = []
  for (let d = inceputLuna(iso), end = sfarsitLuna(iso); d <= end; d = ziUrmatoare(d)) if (esteZiLucratoare(d, legalSet)) out.push(d)
  return out
}
// Segmentele lunare ale intervalului [df, dt]: [{df, dt}] — unul per lună atinsă
export function segmenteLunare(df, dt) {
  const seg = []
  let s = df
  while (s <= dt) {
    const e = sfarsitLuna(s)
    seg.push({ df: s, dt: e < dt ? e : dt })
    s = ziUrmatoare(e)
  }
  return seg
}

/**
 * Alocarea diurnelor tranșei [df, dt] pe plafonul lunar, per angajat.
 * @param {object} p
 * @param {Array}  p.recsLuna  înregistrări pontaj_records (employee_id, date, diurna, norma) pentru TOATE
 *                             lunile atinse de tranșă, luna întreagă (nu doar df→dt) — din ele se citesc
 *                             CO-ul lunii (C), diurnele de dinaintea tranșei (B) și cele din tranșă (N)
 * @param {string} p.df, p.dt  tranșa (ISO)
 * @param {Set}    p.legalSet  datele cu type='legal' din calendar_days (pentru lunile atinse)
 * @param {number} p.diurnaAmt lei/zi
 * @returns {Map<employee_id, {zileDiurna, zileSalariu, sumaDiurna, sumaSalariu, C, B, N,
 *           sumaDiurnaAnterior, deVerificat, segmente}>}
 *   - sumaDiurnaAnterior = Σ min(C,B) × amt: cât AR TREBUI să fi fost plătit ca diurnă înainte de tranșă,
 *     conform aceleiași alocări — se compară cu ce s-a salvat efectiv în tranșele anterioare (reconciliere)
 *   - deVerificat = zilele (ISO) cu CO ȘI diurnă bifată simultan — nu se rezolvă automat, se semnalează
 */
export function alocaDiurneTransa({ recsLuna, df, dt, legalSet, diurnaAmt }) {
  const amt = Number(diurnaAmt) || 0
  const legal = legalSet || new Set()
  const segs = segmenteLunare(df, dt)
  const zlCache = {}
  const zileLucr = luna => zlCache[luna] || (zlCache[luna] = new Set(zileLucratoareLuna(luna + '-01', legal)))

  // grupare pe angajat: zile distincte cu diurnă, zile lucrătoare cu CO, zile CO+diurnă
  const perEmp = new Map()
  for (const r of recsLuna || []) {
    if (!r || !r.date) continue
    let e = perEmp.get(r.employee_id)
    if (!e) { e = { diurna: new Set(), co: new Set(), ambele: new Set() }; perEmp.set(r.employee_id, e) }
    if (r.diurna === true) e.diurna.add(r.date)
    if (r.norma === 'CO') e.co.add(r.date)
  }

  const out = new Map()
  for (const [empId, e] of perEmp) {
    const res = { zileDiurna: 0, zileSalariu: 0, sumaDiurna: 0, sumaSalariu: 0, C: 0, B: 0, N: 0, sumaDiurnaAnterior: 0, deVerificat: [], segmente: [] }
    for (const s of segs) {
      const luna = lunaDin(s.df), zl = zileLucr(luna)
      let coLucr = 0
      for (const d of e.co) if (lunaDin(d) === luna && zl.has(d)) coLucr++
      const C = Math.max(0, zl.size - coLucr)
      let B = 0, N = 0
      for (const d of e.diurna) {
        if (lunaDin(d) !== luna) continue
        if (d < s.df) B++
        else if (d <= s.dt) { N++; if (e.co.has(d)) res.deVerificat.push(d) }
      }
      const zileDiurna = Math.min(C, B + N) - Math.min(C, B)
      const zileSalariu = N - zileDiurna
      res.segmente.push({ luna, C, B, N, zileDiurna, zileSalariu })
      res.C += C; res.B += B; res.N += N
      res.zileDiurna += zileDiurna; res.zileSalariu += zileSalariu
      res.sumaDiurnaAnterior += Math.min(C, B) * amt
    }
    res.sumaDiurna = res.zileDiurna * amt
    res.sumaSalariu = res.zileSalariu * amt
    res.deVerificat.sort()
    if (res.N > 0 || res.B > 0) out.set(empId, res)
  }
  return out
}
