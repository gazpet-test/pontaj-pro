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
 * Se salvează DOAR zile_diurnă / sumă_diurnă din alocare (în plafon); surplusul rămâne la salariu.
 * @returns {{ plata: {period_from, period_to, payment_date, total_employees, total_days, total_amount, created_by},
 *             detalii: [{employee_id, employee_name, days, amount}] }}
 * @throws dacă nu există nicio diurnă în perioadă (nimic de salvat)
 */
export function construiestePayloadPlata({ snap, alocare, paymentDate, createdBy = null }) {
  if (!snap || !alocare) throw new Error('Snapshot sau alocare lipsă — nu se construiește payload')
  const detalii = []
  for (const emp of snap.emps) {
    const a = alocare.get(emp.id)
    if (!a || a.N === 0) continue
    // includem toți cu diurne bifate, chiar dacă zilele în plafon = 0 (tot merge în salariu)
    detalii.push({ employee_id: emp.id, employee_name: emp.name, days: a.zileDiurna, amount: a.sumaDiurna })
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

// (3) BT — BIC după codul băncii din IBAN
export const BIC_MAP = { BTRL: 'BTRLRO22XXX', INGB: 'INGBROBUXX', RNCB: 'RNCBROBUXX', BRDE: 'BRDEROBUXX', BACX: 'BACXROBUXX', RZBR: 'RZBRROBUXX', CECE: 'CECEROBUXX', BRMA: 'BRMAROBUXX', UGBI: 'UGBIROBUXX', OTPV: 'OTPVROBUXX', TCCL: 'TCCLGB3L' }
export function bicDinIban(iban) {
  if (!iban) return ''
  const code = String(iban).replace(/\s/g, '').substring(4, 8).toUpperCase()
  return BIC_MAP[code] || code + 'ROBUXX'
}
export const HDR_BT = ['OrderNumber', 'SourceAccountNumber', 'TargetAccountNumber', 'BeneficiaryName', 'BeneficiaryBankBIC', 'BeneficiaryFiscalCode', 'Amount', 'PaymentRef1', 'PaymentRef2', 'ValueDate', 'Urgent']

/**
 * (3) Rândurile fișierului BT — DOAR suma confirmată de diurnă (în plafonul lunar); surplusul NU se include.
 * @returns {{ rows: Array<Array>, faraIBAN: string[], total: number }}
 * @throws dacă nu există nicio sumă confirmată de plătit
 */
export function construiesteRanduriBT({ snap, alocare, ibanFirma, dataValuta }) {
  if (!snap || !alocare) throw new Error('Snapshot sau alocare lipsă — nu se construiesc rândurile BT')
  if (!ibanFirma) throw new Error('IBAN-ul firmei lipsește (setarea „iban_firma")')
  const rows = [], faraIBAN = []
  let nr = 1
  for (const emp of snap.emps) {
    const a = alocare.get(emp.id)
    if (!a || a.N === 0) continue
    const sumaConfirmata = a.sumaDiurna
    if (sumaConfirmata <= 0) continue   // tot surplusul — nu apare în BT diurne
    if (!emp.iban) faraIBAN.push(emp.name)
    rows.push([nr++, ibanFirma, emp.iban || '', emp.name, bicDinIban(emp.iban), '', sumaConfirmata, 'diurna', 'diurna', dataValuta, 'F'])
  }
  if (!rows.length) throw new Error('Nu există diurne confirmate de plătit în această perioadă')
  return { rows, faraIBAN, total: rows.reduce((s, r) => s + r[6], 0) }
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
    if (!er.length && !incetatInLuna) return null
    const C = a ? a.C : 0, B = a ? a.B : 0, N = a ? a.N : 0
    const diurnaReala = N                                   // zile distincte cu diurnă în tranșă (o zi pe două șantiere = o zi)
    const diurnaMax = a ? a.zileDiurna : 0                  // „Diurnă Max. Admisă" = zilele din tranșă care intră în plafonul lunar
    const pesteLimita = a ? a.zileSalariu : 0               // „Peste limită" = ce merge la salariu
    const bugetLunar = C * diurnaAmt
    const platitAnteriorSuma = a ? a.sumaDiurnaAnterior : 0 // Σ min(C,B) × lei/zi — cât ar fi trebuit plătit ca diurnă înainte de tranșă
    const restBuget = Math.max(0, bugetLunar - platitAnteriorSuma)
    const sumaAcestExport = N * diurnaAmt
    const pesteBuget = a ? a.sumaSalariu : 0
    // Reconciliere: înregistrat (istoric) vs recalculat — determinat / nedeterminat (plată peste 1 ale lunii) / invalid
    const dif = diferentaInregistratRecalculat(platitPeLuni.get(emp.id), platitAnteriorSuma)
    const siteMap = {}
    er.forEach(r => { const s = r.sites?.name || 'Nealocate'; siteMap[s] = (siteMap[s] || 0) + 1 })
    let sites = Object.entries(siteMap).map(([name, zile]) => ({ name, zile, val: zile * diurnaAmt }))
    if (!sites.length) sites = [{ name: 'Nealocate', zile: 0, val: 0 }]
    const p = emp.name.split(' ')
    const faraZile = diurnaReala === 0 && incetatInLuna
    return {
      nume: p[0], prenume: p.slice(1).join(' '), sites, totalZile: diurnaReala, totalVal: diurnaReala * diurnaAmt,
      diurnaMax: faraZile ? 0 : diurnaMax,
      normeCumulate: C, zilePlatiteAnterior: B, pesteLimita, pesteCumulat: pesteBuget, depasesteLunar: pesteBuget > 0,
      bugetLunar, platitAnteriorSuma, sumaAcestExport, restBuget, restDePlata: pesteBuget,
      deVerificat: a ? a.deVerificat : [], deVerificatAnterior: a ? a.deVerificatAnterior : [], deVerificatUlterior: a ? a.deVerificatUlterior : [],
      diferentaPlatit: dif.valoare, diferentaText: dif.text,
      incetatLa: incetatInLuna ? emp.termination_date : null,
    }
  }).filter(Boolean).sort((a, b) => {
    const n = (a.nume || '').localeCompare((b.nume || ''), 'ro')
    return n !== 0 ? n : (a.prenume || '').localeCompare((b.prenume || ''), 'ro')
  })
  if (!empStats.length) throw new Error('Nu există diurne în perioadă')
  return empStats
}

// Text pentru coloana „De verificat (CO + diurnă)" — în tranșă / înainte / după, în aceeași lună
const fmtZi = d => d.slice(8, 10) + '.' + d.slice(5, 7)
export function textDeVerificat(e) {
  return [
    e.deVerificat?.length ? `CO+diurnă: ${e.deVerificat.map(fmtZi).join(', ')}` : '',
    e.deVerificatAnterior?.length ? `ant.: ${e.deVerificatAnterior.map(fmtZi).join(', ')}` : '',
    e.deVerificatUlterior?.length ? `ult.: ${e.deVerificatUlterior.map(fmtZi).join(', ')}` : '',
  ].filter(Boolean).join(' · ')
}
