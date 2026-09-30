// ════════════════════════════════════════════════════════════════
// diurneFlux.js — construirea PURĂ a ieșirilor celor trei fluxuri de diurne dintr-UN SINGUR snapshot + o
// singură alocare (diurneAlocare.js): (1) rândurile exportului Excel, (2) payload-ul salvat în
// diurna_payments / diurna_payment_details, (3) rândurile fișierului BT.
// Fără React, fără Supabase: App.jsx doar citește snapshotul, apelează funcțiile de aici și scrie/afișează.
// Așa un test poate demonstra că exportul, plata salvată și sumele BT vin din aceeași alocare, iar un snapshot
// eșuat (throw la citire) nu produce niciun payload.
// ════════════════════════════════════════════════════════════════
import { alocaDinSnapshot, diferentaInregistratRecalculat } from './diurneAlocare.js'

// Alocarea comună a unui snapshot (o singură dată per flux) — wrapper explicit ca apelanții să nu recalculeze
export function alocareDinSnapshot(snap) {
  if (!snap || !Array.isArray(snap.recs) || !Array.isArray(snap.emps)) throw new Error('Snapshot lipsă sau incomplet — nu se poate aloca')
  return alocaDinSnapshot(snap)
}

/**
 * (2) Payload-ul salvării (savePayment): ce intră în diurna_payments + diurna_payment_details.
 * Se salvează DOAR zile_diurnă / sumă_diurnă din alocare (în plafon); surplusul rămâne la salariu, dar se
 * ÎNREGISTREAZĂ pe detaliu (zile_salariu, suma_salariu) și defalcarea pe luni (defalcare_luni) — ca reconcilierea
 * ulterioară să nu recalculeze nimic.
 * @returns {{ plata: {period_from, period_to, payment_date, total_employees, total_days, total_amount, created_by},
 *             detalii: [{employee_id, employee_name, days, amount, zile_diurna, zile_salariu, suma_salariu,
 *                        defalcare_luni:[{luna, zile_diurna, suma_diurna, zile_salariu, suma_salariu}]}] }}
 * @throws dacă nu există nicio diurnă în perioadă (nimic de salvat)
 */
export function construiestePayloadPlata({ snap, alocare, paymentDate, createdBy = null }) {
  if (!snap || !alocare) throw new Error('Snapshot sau alocare lipsă — nu se construiește payload')
  const amt = snap.diurnaAmt
  const detalii = []
  for (const emp of snap.emps) {
    const a = alocare.get(emp.id)
    if (!a || a.N === 0) continue
    // includem toți cu diurne bifate, chiar dacă zilele în plafon = 0 (tot merge în salariu)
    const defalcare_luni = (a.segmente || []).map(s => ({
      luna: s.luna, zile_diurna: s.zileDiurna, suma_diurna: s.zileDiurna * amt, zile_salariu: s.zileSalariu, suma_salariu: s.zileSalariu * amt,
    }))
    detalii.push({
      employee_id: emp.id, employee_name: emp.name, days: a.zileDiurna, amount: a.sumaDiurna,
      zile_diurna: a.zileDiurna, zile_salariu: a.zileSalariu, suma_salariu: a.sumaSalariu, defalcare_luni,
    })
  }
  if (!detalii.length) throw new Error('Nu există diurne în perioadă')
  const plata = {
    period_from: snap.df, period_to: snap.dt, payment_date: paymentDate,
    total_employees: detalii.length,
    total_days: detalii.reduce((s, e) => s + e.days, 0),
    total_amount: detalii.reduce((s, e) => s + e.amount, 0),
    created_by: createdBy,
  }
  return { plata, detalii }
}

export const VERSIUNE_FORMULA_DIURNE = 'r5'

/**
 * (2b) Argumentele EXACTE pentru supabase.rpc('diurna_salveaza_plata', args) — o singură tranzacție pe server.
 * Amprenta (sha256 hex peste forma canonică a pontajului din lunile snapshotului, tarif, zile legale și lista de
 * angajați — amprentaHash din diurneAlocare.js) e recalculată de server; nepotrivire ⇒ P0002, nimic salvat.
 * @throws dacă lipsește cheia de idempotență sau amprenta (nu se apelează RPC-ul „pe ghicite")
 */
export function construiesteApelRpc({ snap, alocare, idempotencyKey, amprenta, notes = null }) {
  if (!idempotencyKey) throw new Error('Cheie de idempotență lipsă — nu se apelează salvarea')
  if (typeof amprenta !== 'string' || !/^[0-9a-f]{64}$/.test(amprenta)) throw new Error('Amprenta datelor lipsă sau invalidă — nu se apelează salvarea')
  const { detalii } = construiestePayloadPlata({ snap, alocare, paymentDate: null })
  const employeeIds = snap.emps.map(e => e.id)
  const tarifText = String(snap.diurnaAmt)
  return {
    p_period_from: snap.df, p_period_to: snap.dt, p_notes: notes,
    p_detalii: detalii, p_idempotency_key: idempotencyKey,
    p_amprenta: amprenta, p_employee_ids: employeeIds,
    p_month_start: snap.monthStart, p_month_end: snap.monthEnd, p_tarif_text: tarifText,
    p_baza_calcul: { amprenta, tarif: tarifText, month_start: snap.monthStart, month_end: snap.monthEnd, employee_ids_count: employeeIds.length, versiune_formula: VERSIUNE_FORMULA_DIURNE },
  }
}

/**
 * (2c) Orchestrarea salvării (savePayment, partea fără UI): UN apel RPC tranzacțional; fără insert-uri separate,
 * fără ștergere compensatorie. Eroarea RPC-ului (inclusiv P0002 „datele s-au schimbat") se propagă neschimbată.
 * @returns {Promise<{payment_id:number, inserted:boolean, total_employees?, total_days?, total_amount?}>}
 */
export async function salveazaPlataDiurne({ supabase, snap, alocare, idempotencyKey, amprenta, paymentDate = null, notes = null }) {
  if (!supabase || typeof supabase.rpc !== 'function') throw new Error('Client Supabase lipsă')
  const args = construiesteApelRpc({ snap, alocare, idempotencyKey, amprenta, notes })
  if (paymentDate) args.p_payment_date = paymentDate
  const { data, error } = await supabase.rpc('diurna_salveaza_plata', args)
  if (error) { const e = new Error(error.message || String(error)); e.code = error.code; e.details = error.details; throw e }
  if (!data || typeof data.payment_id !== 'number') throw new Error('Salvarea nu a întors id-ul plății')
  return { payment_id: data.payment_id, inserted: data.inserted === true, total_employees: data.total_employees, total_days: data.total_days, total_amount: data.total_amount }
}

// (3) BT — BIC după codul băncii din IBAN
export const BIC_MAP = { BTRL: 'BTRLRO22XXX', INGB: 'INGBROBUXX', RNCB: 'RNCBROBUXX', BRDE: 'BRDEROBUXX', BACX: 'BACXROBUXX', RZBR: 'RZBRROBUXX', CECE: 'CECEROBUXX', BRMA: 'BRMAROBUXX', UGBI: 'UGBIROBUXX', OTPV: 'OTPVROBUXX', TCCL: 'TCCLGB3L' }
export function bicDinIban(iban) {
  if (!iban) return ''
  const code = String(iban).replace(/\s/g, '').substring(4, 8).toUpperCase()
  return BIC_MAP[code] || code + 'ROBUXX'
}
export const HDR_BT = ['OrderNumber', 'SourceAccountNumber', 'TargetAccountNumber', 'BeneficiaryName', 'BeneficiaryBankBIC', 'BeneficiaryFiscalCode', 'Amount', 'PaymentRef1', 'PaymentRef2', 'ValueDate', 'Urgent']

/**
 * (3) Rândurile fișierului BT — din plata SALVATĂ (diurna_payments + diurna_payment_details citite din BD),
 * NU dintr-un recalcul: suma din BT = amount-ul înregistrat pe detaliu. Detaliile cu amount ≤ 0 (tot surplusul →
 * salariu) NU apar. IBAN-ul angajatului vine din `emps` (employees.iban) după employee_id.
 * Compatibilitate (teste vechi): dacă se dau `snap` + `alocare` în loc de `plata` + `detalii`, detaliile se
 * derivă prin construiestePayloadPlata — App.jsx NU folosește calea asta.
 * @param {{plata:{period_from,period_to}, detalii:[{employee_id, employee_name, amount}], emps:[{id,name,iban}], ibanFirma:string, dataValuta:string}} p
 * @returns {{ rows: Array<Array>, faraIBAN: string[], total: number }}
 * @throws dacă lipsește IBAN-ul firmei (fără fallback), lipsesc detaliile sau nu există nicio sumă de plătit
 */
export function construiesteRanduriBT({ plata, detalii, emps, snap, alocare, ibanFirma, dataValuta }) {
  if (!ibanFirma || !String(ibanFirma).trim()) throw new Error('IBAN-ul firmei lipsește (setarea „iban_firma")')
  if (!detalii && snap && alocare) {
    emps = emps || snap.emps
    try { const p = construiestePayloadPlata({ snap, alocare, paymentDate: null }); plata = p.plata; detalii = p.detalii }
    catch (e) { if (!/Nu există diurne/.test(e?.message || '')) throw e; detalii = [] }   // fără diurne ⇒ fără rânduri BT
  }
  if (!Array.isArray(detalii)) throw new Error('Plata sau detaliile lipsă — nu se construiesc rândurile BT')
  if (!Array.isArray(emps)) throw new Error('Lista de angajați lipsă — nu se construiesc rândurile BT')
  const empById = new Map(emps.map(e => [e.id, e]))
  const rows = [], faraIBAN = []
  let nr = 1
  for (const d of detalii) {
    const suma = Number(d.amount)
    if (!Number.isFinite(suma)) throw new Error(`Sumă înregistrată nenumerică pe detaliul angajatului ${d.employee_id} („${d.amount}") — BT oprit`)
    if (suma <= 0) continue   // tot surplusul — nu apare în BT diurne
    const emp = empById.get(d.employee_id)
    const nume = d.employee_name || emp?.name || String(d.employee_id)
    const iban = emp?.iban || ''
    if (!iban) faraIBAN.push(nume)
    rows.push([nr++, ibanFirma, iban, nume, bicDinIban(iban), '', suma, 'diurna', 'diurna', dataValuta, 'F'])
  }
  if (!rows.length) throw new Error('Nu există diurne confirmate de plătit în această perioadă')
  return { rows, faraIBAN, total: rows.reduce((s, r) => s + r[6], 0), plata }
}

/**
 * (1) Rândurile exportului Excel (empStats din exportDiurne), per angajat, din același snapshot + alocare.
 * @param p.platitPeLuni  Map din platitAnteriorPeLuni (reconciliere) — opțional
 * @returns Array<{nume, prenume, sites:[{name,zile,val}], totalZile, totalVal, diurnaMax, normeCumulate, zilePlatiteAnterior,
 *   pesteLimita, pesteCumulat, depasesteLunar, bugetLunar, platitAnteriorSuma, sumaAcestExport, restBuget, restDePlata,
 *   deVerificat, deVerificatAnterior, deVerificatUlterior, diferentaPlatit, diferentaText, incetatLa}>
 * @throws dacă nu există diurne în perioadă
 */
export function construiesteRanduriExport({ snap, alocare, platitPeLuni = new Map() }) {
  if (!snap || !alocare) throw new Error('Snapshot sau alocare lipsă — nu se construiesc rândurile exportului')
  const { df, dt, emps, monthStartTransa: monthStart, diurnaAmt } = snap
  const diurnaRecs = snap.recs.filter(r => r.diurna === true && r.date >= df && r.date <= dt)
  const empStats = emps.map(emp => {
    const er = diurnaRecs.filter(r => r.employee_id === emp.id)
    const a = alocare.get(emp.id)
    // Angajatul cu încetare în luna exportată rămâne în listă chiar dacă în tranșa asta are zero zile — apare cu 0,
    // ca să poată fi întocmit ordinul de deplasare și împărțită diurna pe lucrări până la închiderea lunii.
    const incetatInLuna = !emp.active && emp.termination_date && emp.termination_date >= monthStart
    const platitAnteriorSuma = a ? a.sumaDiurnaAnterior : 0 // Σ min(C,B) × lei/zi — cât ar fi trebuit plătit ca diurnă înainte de tranșă
    // Reconciliere: înregistrat (istoric) vs recalculat — determinat / nedeterminat (plată peste 1 ale lunii) / invalid
    const rec = platitPeLuni.get(emp.id)
    const dif = diferentaInregistratRecalculat(rec, platitAnteriorSuma)
    // Angajat FĂRĂ zile în tranșă, dar cu istoric de reconciliat (diferență ≠ 0, nedeterminat, invalid) sau cu conflicte
    // CO+diurnă înainte/după tranșă în aceeași lună → rămâne în audit, cu 0 zile și toate sumele curente 0.
    const areIstoric = !!rec && (rec.invalid || rec.nedeterminat || rec.diferentaTotal !== 0 || dif.valoare !== 0)
    const areConflicte = !!a && (a.deVerificatAnterior.length > 0 || a.deVerificatUlterior.length > 0)
    if (!er.length && !incetatInLuna && !areIstoric && !areConflicte) return null
    const C = a ? a.C : 0, B = a ? a.B : 0, N = a ? a.N : 0
    const diurnaReala = N                                   // zile distincte cu diurnă în tranșă (o zi pe două șantiere = o zi)
    const diurnaMax = a ? a.zileDiurna : 0                  // „Diurnă Max. Admisă" = zilele din tranșă care intră în plafonul lunar
    const pesteLimita = a ? a.zileSalariu : 0               // „Peste limită" = ce merge la salariu
    const bugetLunar = C * diurnaAmt
    const restBuget = Math.max(0, bugetLunar - platitAnteriorSuma)
    const sumaAcestExport = N * diurnaAmt
    const pesteBuget = a ? a.sumaSalariu : 0
    // Rândurile pe șantier: „o zi = o zi" și aici. Fiecare zi DISTINCTĂ se atribuie unui singur șantier —
    // determinist, primul după nume dintre cele bifate în ziua aceea; două înregistrări pe același șantier în aceeași zi
    // = o zi. Ziua bifată pe mai multe șantiere se semnalează în distributieAmbigua ('YYYY-MM-DD: A, B'), nu se împarte.
    const peZi = new Map()
    for (const r of er) { const s = r.sites?.name || 'Nealocate'; let set = peZi.get(r.date); if (!set) { set = new Set(); peZi.set(r.date, set) } set.add(s) }
    const siteMap = {}, distributieAmbigua = []
    for (const zi of [...peZi.keys()].sort()) {
      const nume = [...peZi.get(zi)].sort()
      siteMap[nume[0]] = (siteMap[nume[0]] || 0) + 1
      if (nume.length > 1) distributieAmbigua.push(`${zi}: ${nume.join(', ')}`)
    }
    let sites = Object.entries(siteMap).map(([name, zile]) => ({ name, zile, val: zile * diurnaAmt }))
    if (!sites.length) sites = [{ name: 'Nealocate', zile: 0, val: 0 }]
    const p = emp.name.split(' ')
    const faraZile = diurnaReala === 0
    return {
      nume: p[0], prenume: p.slice(1).join(' '), sites, totalZile: diurnaReala, totalVal: diurnaReala * diurnaAmt,
      diurnaMax: faraZile ? 0 : diurnaMax,
      normeCumulate: C, zilePlatiteAnterior: B, pesteLimita, pesteCumulat: pesteBuget, depasesteLunar: pesteBuget > 0,
      bugetLunar, platitAnteriorSuma, sumaAcestExport, restBuget, restDePlata: pesteBuget,
      deVerificat: a ? a.deVerificat : [], deVerificatAnterior: a ? a.deVerificatAnterior : [], deVerificatUlterior: a ? a.deVerificatUlterior : [],
      distributieAmbigua,
      diferentaPlatit: dif.valoare, diferentaText: dif.text,
      incetatLa: incetatInLuna ? emp.termination_date : null,
      faraZileInTransa: faraZile,
    }
  }).filter(Boolean).sort((a, b) => {
    const n = (a.nume || '').localeCompare((b.nume || ''), 'ro')
    return n !== 0 ? n : (a.prenume || '').localeCompare((b.prenume || ''), 'ro')
  })
  if (!empStats.length) throw new Error('Nu există diurne în perioadă')
  return empStats
}

// Text pentru coloana „De verificat (CO + diurnă)" — în tranșă / înainte / după, în aceeași lună;
// + „amb.:" = zile bifate pe mai multe șantiere (atribuite unui singur șantier în rândurile pe șantier, de verificat)
const fmtZi = d => d.slice(8, 10) + '.' + d.slice(5, 7)
const fmtAmb = s => { const i = s.indexOf(':'); return i === 10 ? fmtZi(s.slice(0, 10)) + s.slice(10) : s }
export function textDeVerificat(e) {
  return [
    e.deVerificat?.length ? `CO+diurnă: ${e.deVerificat.map(fmtZi).join(', ')}` : '',
    e.deVerificatAnterior?.length ? `ant.: ${e.deVerificatAnterior.map(fmtZi).join(', ')}` : '',
    e.deVerificatUlterior?.length ? `ult.: ${e.deVerificatUlterior.map(fmtZi).join(', ')}` : '',
    e.distributieAmbigua?.length ? `amb.: ${e.distributieAmbigua.map(fmtAmb).join('; ')}` : '',
  ].filter(Boolean).join(' · ')
}
