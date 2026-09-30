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

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/
export function esteDataValida(iso) {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return false
  const d = new Date(iso + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Validarea intrărilor comune (tarif, interval, calendar). Aruncă Error cu mesaj clar — apelanții
 * (export / savePayment / BT) prind eroarea, afișează toast și OPRESC operația (nu salvează, nu exportă).
 * - diurnaAmt: număr finit > 0 (0 NU e permis — o tranșă cu tarif 0 ar salva plăți goale fără să anunțe)
 * - df/dt: ISO valide, df <= dt
 * - legalSet: obligatoriu un Set — calendarul neîncărcat (undefined/null) NU înseamnă „fără sărbători"
 */
export function valideazaIntrariDiurne({ df, dt, legalSet, diurnaAmt }) {
  const amt = typeof diurnaAmt === 'number' ? diurnaAmt : (typeof diurnaAmt === 'string' && diurnaAmt.trim() !== '' ? Number(diurnaAmt) : NaN)
  if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Tarif diurnă invalid (${String(diurnaAmt)}) — trebuie un număr > 0 (setarea „diurna_amount")`)
  if (!esteDataValida(df) || !esteDataValida(dt)) throw new Error(`Interval invalid: de la „${String(df)}" până la „${String(dt)}"`)
  if (df > dt) throw new Error(`Interval inversat: de la ${df} până la ${dt}`)
  if (!(legalSet instanceof Set)) throw new Error('Calendarul de sărbători legale nu a fost încărcat — operația se oprește (nu presupunem „fără sărbători")')
  return amt
}

/**
 * Alocarea diurnelor tranșei [df, dt] pe plafonul lunar, per angajat.
 * @param {object} p
 * @param {Array}  p.recsLuna  înregistrări pontaj_records (employee_id, date, diurna, norma) pentru TOATE
 *                             lunile atinse de tranșă, luna întreagă (nu doar df→dt) — din ele se citesc
 *                             CO-ul lunii (C), diurnele de dinaintea tranșei (B) și cele din tranșă (N)
 * @param {string} p.df, p.dt  tranșa (ISO)
 * @param {Set}    p.legalSet  datele cu type='legal' din calendar_days (pentru lunile atinse) — OBLIGATORIU
 * @param {number} p.diurnaAmt lei/zi — finit, > 0
 * @returns {Map<employee_id, {zileDiurna, zileSalariu, sumaDiurna, sumaSalariu, C, B, N,
 *           sumaDiurnaAnterior, deVerificat, deVerificatAnterior, segmente}>}
 *   - sumaDiurnaAnterior = Σ min(C,B) × amt: cât AR TREBUI să fi fost plătit ca diurnă înainte de tranșă,
 *     conform aceleiași alocări — se compară cu ce s-a salvat efectiv în tranșele anterioare (reconciliere)
 *   - deVerificat = zilele (ISO) din TRANȘĂ cu CO ȘI diurnă bifată simultan — nu se rezolvă automat
 *   - deVerificatAnterior = aceleași conflicte în lunile tranșei, ANTERIOARE tranșei (influențează C și B)
 * @throws Error la intrări invalide (vezi valideazaIntrariDiurne)
 */
export function alocaDiurneTransa({ recsLuna, df, dt, legalSet, diurnaAmt }) {
  const amt = valideazaIntrariDiurne({ df, dt, legalSet, diurnaAmt })
  const legal = legalSet
  const segs = segmenteLunare(df, dt)
  const zlCache = {}
  const zileLucr = luna => zlCache[luna] || (zlCache[luna] = new Set(zileLucratoareLuna(luna + '-01', legal)))

  // grupare pe angajat: zile distincte cu diurnă, zile cu CO
  const perEmp = new Map()
  for (const r of recsLuna || []) {
    if (!r || !r.date) continue
    let e = perEmp.get(r.employee_id)
    if (!e) { e = { diurna: new Set(), co: new Set() }; perEmp.set(r.employee_id, e) }
    if (r.diurna === true) e.diurna.add(r.date)
    if (r.norma === 'CO') e.co.add(r.date)
  }

  const out = new Map()
  for (const [empId, e] of perEmp) {
    const res = { zileDiurna: 0, zileSalariu: 0, sumaDiurna: 0, sumaSalariu: 0, C: 0, B: 0, N: 0, sumaDiurnaAnterior: 0, deVerificat: [], deVerificatAnterior: [], segmente: [] }
    for (const s of segs) {
      const luna = lunaDin(s.df), zl = zileLucr(luna)
      let coLucr = 0
      for (const d of e.co) if (lunaDin(d) === luna && zl.has(d)) coLucr++
      const C = Math.max(0, zl.size - coLucr)
      let B = 0, N = 0
      for (const d of e.diurna) {
        if (lunaDin(d) !== luna) continue
        if (d < s.df) { B++; if (e.co.has(d)) res.deVerificatAnterior.push(d) }
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
    res.deVerificat.sort(); res.deVerificatAnterior.sort()
    if (res.N > 0 || res.B > 0) out.set(empId, res)
  }
  return out
}

/**
 * Reconciliere: cât s-a ÎNREGISTRAT efectiv (diurna_payment_details) în plățile salvate anterior tranșei,
 * atribuit lunilor tranșei [df, dt]. Se compară cu sumaDiurnaAnterior (recalculat).
 * @param {Array} p.plati  diurna_payments cu period_to < df, cu diurna_payment_details[{employee_id, amount}]
 *   - plată într-o singură lună → suma înregistrată intră întreagă în luna ei (dacă e printre lunile tranșei)
 *   - plată peste 1 ale lunii (ex. 26.09–02.10) → se recalculează cu aceeași formulă pe segmente și fiecare
 *     lună primește partea ei; diferența față de suma înregistrată (dacă există) rămâne în luna în care a
 *     început plata. Așa, la tranșa următoare din octombrie, cei X lei din 01–02.10 sunt ai lunii octombrie.
 *     recsLuna trebuie să acopere și lunile acelor plăți (snapshotul se extinde de la prima plată reconciliată).
 * @returns {Map<employee_id, number>} suma înregistrată atribuită lunilor tranșei
 */
export function platitAnteriorPeLuni({ plati, recsLuna, df, dt, legalSet, diurnaAmt }) {
  const amt = valideazaIntrariDiurne({ df, dt, legalSet, diurnaAmt })
  const luniTransa = new Set(segmenteLunare(df, dt).map(s => lunaDin(s.df)))
  const out = new Map()
  const add = (id, v) => out.set(id, (out.get(id) || 0) + v)
  for (const p of plati || []) {
    if (!p || !esteDataValida(p.period_from) || !esteDataValida(p.period_to) || p.period_to >= df) continue
    const det = p.diurna_payment_details || []
    const segs = segmenteLunare(p.period_from, p.period_to)
    if (segs.length === 1) {
      if (!luniTransa.has(lunaDin(p.period_from))) continue
      for (const d of det) add(d.employee_id, Number(d.amount) || 0)
      continue
    }
    const aloc = alocaDiurneTransa({ recsLuna, df: p.period_from, dt: p.period_to, legalSet, diurnaAmt: amt })
    const lunaStart = lunaDin(p.period_from)
    for (const d of det) {
      const inregistrat = Number(d.amount) || 0
      const a = aloc.get(d.employee_id)
      const recalcTotal = a ? a.sumaDiurna : 0
      const dif = inregistrat - recalcTotal
      for (const s of segs) {
        const luna = lunaDin(s.df)
        if (!luniTransa.has(luna)) continue
        const seg = a ? a.segmente.find(x => x.luna === luna) : null
        add(d.employee_id, (seg ? seg.zileDiurna * amt : 0) + (luna === lunaStart ? dif : 0))
      }
    }
  }
  return out
}

// ════════════════════════════════════════════════════════════════
// incarcaSnapshotDiurne — citirea COMUNĂ a intrărilor pentru cele trei fluxuri (export Excel, savePayment, BT).
// Orice citire eșuată (employees, pontaj_records paginat, calendar_days, settings) sau paginare oprită la
// limită → throw; apelantul afișează toast și OPREȘTE operația (nu continuă cu []).
// Snapshotul e pe LUNILE ÎNTREGI atinse de tranșă (nu doar df→dt): fără bifele și CO-ul de dinaintea
// tranșei, C și B ar ieși greșit (vezi testul „snapshot limitat la tranșă").
// @param {object} o
//   df, dt        tranșa
//   siteIds       (opțional) restricție pe șantiere pentru non-admin
//   recsSelect    (opțional) coloanele din pontaj_records (implicit doar cele necesare alocării)
//   extindeDeLa   (opțional) ISO — snapshotul începe de la luna acestei date (reconciliere plăți peste 1 ale lunii)
// ════════════════════════════════════════════════════════════════
export const LIMITA_PAGINARE = 200000
export async function incarcaSnapshotDiurne(supabase, { df, dt, siteIds = null, recsSelect = 'employee_id,date,diurna,norma', extindeDeLa = null } = {}) {
  if (!supabase) throw new Error('Client Supabase lipsă')
  if (!esteDataValida(df) || !esteDataValida(dt)) throw new Error(`Interval invalid: de la „${String(df)}" până la „${String(dt)}"`)
  if (df > dt) throw new Error(`Interval inversat: de la ${df} până la ${dt}`)
  const monthStart = inceputLuna(extindeDeLa && extindeDeLa < df ? extindeDeLa : df), monthEnd = sfarsitLuna(dt)
  const monthStartTransa = inceputLuna(df)

  const { data: st, error: eSt } = await supabase.from('settings').select('*')
  if (eSt) throw new Error('Nu s-au putut citi setările: ' + (eSt.message || eSt))
  const sAmt = (st || []).find(x => x.key === 'diurna_amount')
  if (!sAmt) throw new Error('Setarea „diurna_amount" lipsește')
  const diurnaAmt = valideazaIntrariDiurne({ df, dt, legalSet: new Set(), diurnaAmt: sAmt.value })

  const { data: calData, error: eCal } = await supabase.from('calendar_days').select('date,type,description').gte('date', monthStart).lte('date', monthEnd)
  if (eCal) throw new Error('Nu s-a putut citi calendarul: ' + (eCal.message || eCal))
  const legalSet = new Set((calData || []).filter(d => d.type === 'legal').map(d => d.date))

  // Eligibili: activii + cei cu încetare de la începutul lunii tranșei încolo (au zile bifate înainte de plecare)
  let eq = supabase.from('employees').select('*').or(`active.eq.true,termination_date.gte.${monthStartTransa}`).order('name')
  if (Array.isArray(siteIds) && siteIds.length > 0) eq = eq.in('site_id', siteIds)
  const { data: emps, error: eEmp } = await eq
  if (eEmp) throw new Error('Nu s-au putut citi angajații: ' + (eEmp.message || eEmp))
  const empIds = (emps || []).map(e => e.id)

  const recs = []
  if (empIds.length) {
    let off = 0
    while (true) {
      const { data: p, error: eRec } = await supabase.from('pontaj_records').select(recsSelect).gte('date', monthStart).lte('date', monthEnd).in('employee_id', empIds).range(off, off + 999)
      if (eRec) throw new Error('Nu s-a putut citi pontajul: ' + (eRec.message || eRec))
      if (!p || p.length === 0) break
      recs.push(...p)
      if (p.length < 1000) break
      off += 1000
      if (off > LIMITA_PAGINARE) throw new Error(`Pontajul depășește limita de paginare (${LIMITA_PAGINARE} rânduri) — operația se oprește`)
    }
  }
  return { df, dt, monthStart, monthEnd, monthStartTransa, diurnaAmt, legalSet, calData: calData || [], emps: emps || [], recs }
}

// Alocarea direct dintr-un snapshot (aceleași intrări → aceleași sume în toate cele trei fluxuri)
export function alocaDinSnapshot(snap) {
  return alocaDiurneTransa({ recsLuna: snap.recs, df: snap.df, dt: snap.dt, legalSet: snap.legalSet, diurnaAmt: snap.diurnaAmt })
}

// Rezumat pentru confirmarea de salvare (savePayment): ce se va salva efectiv, recalculat din BD acum
export function rezumatAlocare(alocare, emps) {
  const ids = emps ? new Set(emps.map(e => e.id)) : null
  const r = { angajati: 0, zileDiurna: 0, sumaDiurna: 0, sumaSalariu: 0, conflicte: 0, conflicteAnterior: 0 }
  for (const [id, a] of alocare) {
    if (ids && !ids.has(id)) continue
    if (a.N === 0) continue
    r.angajati++; r.zileDiurna += a.zileDiurna; r.sumaDiurna += a.sumaDiurna; r.sumaSalariu += a.sumaSalariu
    if (a.deVerificat.length) r.conflicte++
    if (a.deVerificatAnterior.length) r.conflicteAnterior++
  }
  return r
}
