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
 *   - deVerificatUlterior = aceleași conflicte în lunile tranșei, DUPĂ dt (ex. tranșa 01–25.09, CO+diurnă pe
 *     30.09): ziua de CO scade C (plafonul lunii) și deci afectează tranșa curentă, deși nu e în ea — se
 *     semnalează, nu se rezolvă automat
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
    const res = { zileDiurna: 0, zileSalariu: 0, sumaDiurna: 0, sumaSalariu: 0, C: 0, B: 0, N: 0, sumaDiurnaAnterior: 0, deVerificat: [], deVerificatAnterior: [], deVerificatUlterior: [], segmente: [] }
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
        else if (e.co.has(d)) res.deVerificatUlterior.push(d)   // după tranșă, în aceeași lună: nu consumă, dar CO-ul scade C
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
    res.deVerificat.sort(); res.deVerificatAnterior.sort(); res.deVerificatUlterior.sort()
    if (res.N > 0 || res.B > 0 || res.deVerificatUlterior.length) out.set(empId, res)
  }
  return out
}

/**
 * Reconciliere: ce s-a ÎNREGISTRAT efectiv (diurna_payment_details, la momentul salvării) în plățile
 * anterioare tranșei vs ce ar ieși ACUM din pontaj cu aceeași formulă. Cele trei mărimi sunt ținute STRICT separat:
 *   (a) înregistrat  — suma salvată per plată/angajat (istoric; NU se recalculează, NU se schimbă când se
 *                      modifică ulterior CO/pontaj/tarif). diurna_payment_details are DOAR total per plată
 *                      (employee_id, days, amount) — nu are defalcare pe luni. De aceea, la o plată peste 1 ale
 *                      lunii (ex. 26.09–02.10) partea înregistrată a fiecărei luni este NEDETERMINATĂ — nu se
 *                      reconstruiește din recalcul și nu se atribuie prin convenție lunii de start.
 *                      Excepție verificabilă: dacă rândul de detaliu poartă `amount_luni` ({ 'YYYY-MM': lei })
 *                      a cărui sumă == amount, defalcarea salvată se folosește ca atare.
 *   (b) recalculat   — aceeași plată, recalculată acum din recsLuna cu formula comună (per lună și total)
 *   (c) diferența    — (a) − (b), pe TOATĂ plata (mereu determinabilă când (a) e validă)
 * Sumă înregistrată nenumerică ('abc', null) → plata e marcată INVALIDĂ (nu se tratează ca 0).
 *
 * @param {Array} p.plati  diurna_payments cu period_to < df, cu diurna_payment_details[{employee_id, amount, amount_luni?}]
 *   recsLuna trebuie să acopere și lunile acelor plăți (snapshotul se extinde de la prima plată reconciliată).
 * @returns {Map<employee_id, {
 *   inregistratLuni: number|null,  // (a) atribuit lunilor tranșei — null dacă e nedeterminat sau invalid
 *   nedeterminat: boolean,          // ≥1 plată peste 1 ale lunii fără defalcare salvată
 *   invalid: boolean,               // ≥1 sumă înregistrată nenumerică
 *   inregistratTotal: number|null,  // (a) pe toate plățile reconciliate (întregi) — null dacă invalid
 *   recalculatTotal: number,        // (b) pe aceleași plăți (întregi)
 *   diferentaTotal: number|null,    // (c) = inregistratTotal − recalculatTotal — null dacă invalid
 *   plati: [{ id, period_from, period_to, inregistrat, recalculat, diferenta, invalid, nedeterminat, luni:{'YYYY-MM':{inregistrat|null, recalculat}} }]
 * }>}
 */
export function platitAnteriorPeLuni({ plati, recsLuna, df, dt, legalSet, diurnaAmt }) {
  const amt = valideazaIntrariDiurne({ df, dt, legalSet, diurnaAmt })
  const luniTransa = new Set(segmenteLunare(df, dt).map(s => lunaDin(s.df)))
  const out = new Map()
  const rec = id => { let r = out.get(id); if (!r) { r = { inregistratLuni: 0, nedeterminat: false, invalid: false, inregistratTotal: 0, recalculatTotal: 0, diferentaTotal: 0, plati: [] }; out.set(id, r) } return r }
  const numar = v => (typeof v === 'number' && Number.isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  for (const p of plati || []) {
    if (!p || !esteDataValida(p.period_from) || !esteDataValida(p.period_to) || p.period_from > p.period_to || p.period_to >= df) continue
    const det = p.diurna_payment_details || []
    const segs = segmenteLunare(p.period_from, p.period_to)
    const luniPlata = segs.map(s => lunaDin(s.df))
    if (!luniPlata.some(l => luniTransa.has(l))) continue   // plata nu atinge nicio lună a tranșei
    // (b) recalculul plății, acum, cu formula comună — pe segmente lunare
    const aloc = alocaDiurneTransa({ recsLuna, df: p.period_from, dt: p.period_to, legalSet, diurnaAmt: amt })
    for (const d of det) {
      const r = rec(d.employee_id)
      const a = aloc.get(d.employee_id)
      const inregistrat = numar(d.amount)
      const recalculat = a ? a.sumaDiurna : 0
      const luni = {}
      for (const l of luniPlata) luni[l] = { inregistrat: null, recalculat: a ? ((a.segmente.find(x => x.luna === l) || {}).zileDiurna || 0) * amt : 0 }
      const pl = { id: p.id, period_from: p.period_from, period_to: p.period_to, inregistrat, recalculat, diferenta: inregistrat === null ? null : inregistrat - recalculat, invalid: inregistrat === null, nedeterminat: false, luni }
      if (inregistrat === null) {
        r.invalid = true
      } else if (luniPlata.length === 1) {
        luni[luniPlata[0]].inregistrat = inregistrat            // o singură lună → totalul e al ei
      } else {
        // defalcare SALVATĂ, verificabilă (suma părților == total) — altfel nedeterminat
        const al = d.amount_luni && typeof d.amount_luni === 'object' ? d.amount_luni : null
        const parti = al ? luniPlata.map(l => numar(al[l])) : null
        if (parti && parti.every(v => v !== null) && Math.abs(parti.reduce((s, v) => s + v, 0) - inregistrat) < 0.005) luniPlata.forEach((l, i) => { luni[l].inregistrat = parti[i] })
        else pl.nedeterminat = true
      }
      r.plati.push(pl)
      r.recalculatTotal += recalculat            // (b) e independent de validitatea lui (a)
      if (pl.invalid) continue
      r.inregistratTotal += inregistrat
      if (pl.nedeterminat) r.nedeterminat = true
      else for (const l of luniPlata) if (luniTransa.has(l)) r.inregistratLuni += luni[l].inregistrat
    }
  }
  for (const r of out.values()) {
    if (r.invalid) { r.inregistratLuni = null; r.inregistratTotal = null; r.diferentaTotal = null; continue }
    r.diferentaTotal = r.inregistratTotal - r.recalculatTotal
    if (r.nedeterminat) r.inregistratLuni = null
  }
  return out
}

/**
 * Coloana „Diferență între suma înregistrată și suma recalculată" din export, pentru un angajat.
 * @param rec  intrarea din platitAnteriorPeLuni (sau undefined = nicio plată anterioară reconciliată)
 * @param sumaDiurnaAnterior  Σ min(C,B) × tarif din alocarea curentă (cât ar trebui plătit înainte de tranșă)
 * @returns {{ valoare: number|null, text: string }}
 *   - determinat: valoare = înregistrat (atribuit lunilor tranșei) − sumaDiurnaAnterior; text = '' dacă 0
 *   - nedeterminat (plată peste 1 ale lunii fără defalcare) / invalid: valoare = null, text explică și arată
 *     diferența pe TOATĂ plata (înregistrat − recalculat), care rămâne mereu vizibilă
 */
export function diferentaInregistratRecalculat(rec, sumaDiurnaAnterior) {
  if (!rec) return { valoare: 0 - (sumaDiurnaAnterior || 0), text: '' }
  const fmtP = p => `${p.period_from.slice(8, 10)}.${p.period_from.slice(5, 7)}–${p.period_to.slice(8, 10)}.${p.period_to.slice(5, 7)}`
  if (rec.invalid) {
    const inv = rec.plati.filter(p => p.invalid).map(p => `plata #${p.id} (${fmtP(p)})`).join(', ')
    return { valoare: null, text: `INVALID: sumă înregistrată nenumerică în ${inv} — se verifică în Istoric` }
  }
  if (rec.nedeterminat) {
    const ned = rec.plati.filter(p => p.nedeterminat).map(p => `${fmtP(p)}: înregistrat ${p.inregistrat} / recalculat ${p.recalculat} (dif. ${p.diferenta > 0 ? '+' : ''}${p.diferenta})`).join('; ')
    return { valoare: null, text: `nedeterminat pe lună (plată peste 1 ale lunii, fără defalcare salvată) — pe toată plata: ${ned}` }
  }
  const v = rec.inregistratLuni - (sumaDiurnaAnterior || 0)
  return { valoare: v, text: v !== 0 ? `${v > 0 ? '+' : ''}${v}` : '' }
}

// ════════════════════════════════════════════════════════════════
// incarcaSnapshotDiurne — citirea COMUNĂ a intrărilor pentru cele trei fluxuri (export Excel, savePayment, BT).
// Orice citire eșuată (employees, pontaj_records paginat, calendar_days, settings), paginare peste limită sau
// snapshot INCOMPLET (numărul de rânduri citite ≠ count din BD) → throw; apelantul afișează toast și OPREȘTE
// operația (nu continuă cu []).
// Snapshotul e pe LUNILE ÎNTREGI atinse de tranșă (nu doar df→dt): fără bifele și CO-ul de dinaintea
// tranșei, C și B ar ieși greșit (vezi testul „snapshot limitat la tranșă").
// Scopul pe șantiere — contract explicit (fără „array gol = fără restricție"):
//   scopGlobal: true            → toți angajații eligibili (admin/owner/contabilitate); siteIds trebuie să lipsească
//   siteIds: [..]  (fără scopGlobal) → EXACT acele șantiere; [] → throw „niciun șantier permis"
//   niciunul                    → throw (apelantul trebuie să spună explicit ce vrea)
// Restricția pe șantier se aplică DOAR la lista de angajați; pontajul lor se citește de pe TOATE șantierele
// (consumul lunar B și CO-ul contează indiferent unde a fost bifată ziua).
// @param {object} o
//   df, dt        tranșa
//   scopGlobal    true = fără restricție pe șantiere (explicit)
//   siteIds       array de site_id permise (non-admin)
//   recsSelect    (opțional) coloanele din pontaj_records (implicit doar cele necesare alocării + id)
//   extindeDeLa   (opțional) ISO — snapshotul începe de la luna acestei date (reconciliere plăți peste 1 ale lunii)
// ════════════════════════════════════════════════════════════════
export const LIMITA_PAGINARE = 200000
export const PAGINA_PONTAJ = 1000
export async function incarcaSnapshotDiurne(supabase, { df, dt, siteIds, scopGlobal = false, recsSelect = 'id,employee_id,date,diurna,norma', extindeDeLa = null } = {}) {
  if (!supabase) throw new Error('Client Supabase lipsă')
  if (!esteDataValida(df) || !esteDataValida(dt)) throw new Error(`Interval invalid: de la „${String(df)}" până la „${String(dt)}"`)
  if (df > dt) throw new Error(`Interval inversat: de la ${df} până la ${dt}`)
  if (scopGlobal === true) {
    if (siteIds !== undefined && siteIds !== null) throw new Error('Scop ambiguu: scopGlobal împreună cu siteIds — alege unul')
  } else {
    if (!Array.isArray(siteIds)) throw new Error('Scopul pe șantiere lipsește: apelantul trebuie să dea siteIds (array) sau scopGlobal: true')
    if (siteIds.length === 0) throw new Error('Niciun șantier permis pentru utilizatorul curent — operația se oprește')
  }
  const monthStart = inceputLuna(extindeDeLa && extindeDeLa < df ? extindeDeLa : df), monthEnd = sfarsitLuna(dt)
  const monthStartTransa = inceputLuna(df)

  const { data: st, error: eSt } = await supabase.from('settings').select('*')
  if (eSt) throw new Error('Nu s-au putut citi setările: ' + (eSt.message || eSt))
  const sAmt = (st || []).find(x => x.key === 'diurna_amount')
  if (!sAmt) throw new Error('Setarea „diurna_amount" lipsește')
  const diurnaAmt = valideazaIntrariDiurne({ df, dt, legalSet: new Set(), diurnaAmt: sAmt.value })
  const sIban = (st || []).find(x => x.key === 'iban_firma')

  const { data: calData, error: eCal } = await supabase.from('calendar_days').select('date,type,description').gte('date', monthStart).lte('date', monthEnd)
  if (eCal) throw new Error('Nu s-a putut citi calendarul: ' + (eCal.message || eCal))
  const legalSet = new Set((calData || []).filter(d => d.type === 'legal').map(d => d.date))

  // Eligibili: activii + cei cu încetare de la începutul lunii tranșei încolo (au zile bifate înainte de plecare)
  let eq = supabase.from('employees').select('*').or(`active.eq.true,termination_date.gte.${monthStartTransa}`).order('name').order('id')
  if (scopGlobal !== true) eq = eq.in('site_id', siteIds)
  const { data: emps, error: eEmp } = await eq
  if (eEmp) throw new Error('Nu s-au putut citi angajații: ' + (eEmp.message || eEmp))
  const empIds = (emps || []).map(e => e.id)

  const recs = []
  if (empIds.length) {
    // Paginare deterministă: ordonare pe cheie unică (employee_id, date, id), pagină de mărime explicită;
    // se continuă până la pagină goală sau mai scurtă decât cea cerută; totalul se verifică față de limită
    // ÎNAINTE de return și față de count-ul din BD (completitudine).
    const filtre = q => q.gte('date', monthStart).lte('date', monthEnd).in('employee_id', empIds)
    let off = 0
    while (true) {
      const { data: p, error: eRec } = await filtre(supabase.from('pontaj_records').select(recsSelect)).order('employee_id').order('date').order('id').range(off, off + PAGINA_PONTAJ - 1)
      if (eRec) throw new Error('Nu s-a putut citi pontajul: ' + (eRec.message || eRec))
      if (!p || p.length === 0) break
      recs.push(...p)
      if (recs.length > LIMITA_PAGINARE) throw new Error(`Pontajul depășește limita de paginare (${LIMITA_PAGINARE} rânduri) — operația se oprește`)
      if (p.length < PAGINA_PONTAJ) break
      off += PAGINA_PONTAJ
    }
    const { count, error: eCnt } = await filtre(supabase.from('pontaj_records').select('*', { count: 'exact', head: true }))
    if (eCnt) throw new Error('Nu s-a putut verifica completitudinea pontajului: ' + (eCnt.message || eCnt))
    if (typeof count !== 'number') throw new Error('Nu s-a putut verifica completitudinea pontajului: count lipsă')
    if (count !== recs.length) throw new Error(`Snapshot incomplet: ${recs.length} rânduri citite din ${count} în BD — operația se oprește`)
    if (count > LIMITA_PAGINARE) throw new Error(`Pontajul depășește limita de paginare (${LIMITA_PAGINARE} rânduri) — operația se oprește`)
  }
  return { df, dt, monthStart, monthEnd, monthStartTransa, diurnaAmt, ibanFirma: sIban ? sIban.value : null, legalSet, calData: calData || [], emps: emps || [], recs, completitudine: { citite: recs.length, inBD: recs.length } }
}

// Alocarea direct dintr-un snapshot (aceleași intrări → aceleași sume în toate cele trei fluxuri)
export function alocaDinSnapshot(snap) {
  return alocaDiurneTransa({ recsLuna: snap.recs, df: snap.df, dt: snap.dt, legalSet: snap.legalSet, diurnaAmt: snap.diurnaAmt })
}

// Rezumat pentru confirmarea de salvare (savePayment): ce se va salva efectiv, recalculat din BD acum
export function rezumatAlocare(alocare, emps) {
  const ids = emps ? new Set(emps.map(e => e.id)) : null
  const r = { angajati: 0, zileDiurna: 0, sumaDiurna: 0, sumaSalariu: 0, conflicte: 0, conflicteAnterior: 0, conflicteUlterior: 0 }
  for (const [id, a] of alocare) {
    if (ids && !ids.has(id)) continue
    if (a.N === 0) continue
    r.angajati++; r.zileDiurna += a.zileDiurna; r.sumaDiurna += a.sumaDiurna; r.sumaSalariu += a.sumaSalariu
    if (a.deVerificat.length) r.conflicte++
    if (a.deVerificatAnterior.length) r.conflicteAnterior++
    if (a.deVerificatUlterior.length) r.conflicteUlterior++
  }
  return r
}
