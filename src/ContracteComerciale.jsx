// ===========================================================================
// CONTRACTE COMERCIALE — Tab Administrativ
// 07.06.2026 v1 — Lista upstream/downstream + modal adăugare
// 10.06.2026 v2 — FacturiModal: card „Rest de plată" + mod EUR (contracte valutare)
//                 Parser 401: skip Reg (regularizări curs), storno negativ păstrat,
//                 PV recunoscut ca plată, capturare moneda/valoare_moneda/curs
//                 Alocare automată după șantierul din Observații (multi-contract)
//                 Upsert cu ignoreDuplicates — re-importul NU mai suprascrie alocările
// 10.06.2026 v3 — TVA: fișa 401 e CU TVA, contractele FĂRĂ TVA. cota_tva per document
//                 (auto 19/21 după dată, override la import). Realizat % + Rămas de
//                 facturat = pe NET; Plătit + Rest de plată = CU TVA (cash real).
// Fundație BD: contracte_terti extins + contracte_linii + v_contracte_cu_linii (+ EUR + net TVA)
// 24.06.2026 v4 — Evidență GBE (Garanție Bună Execuție): rubrică tip (reținere/poliță) +
//                 % deblocare recepție/final + perioadă valabilitate + termen recuperare în
//                 formular; ModalGBE (reținut/restituit/rămas din v_gbe_per_contract,
//                 deblocări estimate, restituiri gbe_restituiri, polițe gbe_polite cu alertă
//                 expirare); alerte GBE în AlerteDashboard + badge pe card.
// ===========================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'
import DropZone from './DropZone.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  orange:'#F0883E', purple:'#A371F7', blue:'#1F6FEB', green:'#2EA043',
  yellow:'#D29922', red:'#F85149',
}

const S = {
  card: { background: G.card, borderRadius: 12, border: `1px solid ${G.border}` },
  btnP: { padding: '9px 16px', background: G.orange, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  input: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' },
  label: { fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' },
  select: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer', colorScheme: 'dark' },
}

// ─── Meta date tipuri + roluri ─────────────────────────────────────────────
const TIP_META = {
  asociere:         { label: 'Asociere',         emoji: '🤝', color: G.blue },
  subcontractare:   { label: 'Subcontractare',   emoji: '📋', color: G.yellow },
  prestari_servicii:{ label: 'Prestări Servicii',emoji: '🔧', color: G.purple },
  furnizare_materiale:{ label: 'Furnizare Materiale', emoji: '📦', color: G.orange },
}

const ROL_META = {
  lider:                   { label: 'Asociat Lider',          color: G.green },
  asociat_simplu:          { label: 'Asociat Simplu',         color: G.blue },
  asociat_unic:            { label: 'Asociat Unic',           color: G.orange },
  subcontractor_declarat:  { label: 'Subctr. Declarat',       color: G.yellow },
  subcontractor_parcurs:   { label: 'Subctr. pe Parcurs',     color: G.orange },
  prestator:               { label: 'Prestator',              color: G.purple },
}

const ROLURI_PER_TIP = {
  asociere:          ['lider', 'asociat_simplu', 'asociat_unic'],
  subcontractare:    ['subcontractor_declarat', 'subcontractor_parcurs'],
  prestari_servicii: ['prestator'],
  furnizare_materiale: ['prestator'],
}

const STATUS_META = {
  activ:     { label: 'Activ',     color: G.green },
  draft:     { label: 'Draft',     color: G.yellow },
  suspendat: { label: 'Suspendat', color: G.orange },
  reziliat:  { label: 'Reziliat',  color: G.red },
  finalizat: { label: 'Finalizat', color: G.muted },
}

function fmtRON(v) {
  if (!v) return '—'
  return Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' RON'
}
function fmtEUR(v) {
  if (!v) return '—'
  return Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}
// Cota standard TVA RO după data documentului: 19% până la 31.07.2025, 21% de la 01.08.2025
function cotaTvaLaData(dataISO) {
  return dataISO && dataISO < '2025-08-01' ? 19 : 21
}

// ─── GBE helpers ─────────────────────────────────────────────────────────────
// Zile rămase până la o dată (negativ = depășit). null dacă nu există dată.
function zileRamase(dataISO) {
  if (!dataISO) return null
  const d = new Date(dataISO); d.setHours(0, 0, 0, 0)
  const azi = new Date(); azi.setHours(0, 0, 0, 0)
  return Math.round((d - azi) / 86400000)
}
// Nivel alertă pe baza zilelor rămase: critic (≤30z sau depășit) / warning (≤60z) / null
function nivelAlertaZile(zile) {
  if (zile == null) return null
  if (zile <= 30) return 'critic'
  if (zile <= 60) return 'warning'
  return null
}
const GBE_TIP_META = {
  retinere: { label: 'Reținere', emoji: '✂️', color: '#D29922' },
  polita:   { label: 'Poliță',   emoji: '🏦', color: '#1F6FEB' },
}
const GBE_RESTITUIRE_TIP = [
  { val: 'partiala',            label: 'Restituire parțială' },
  { val: 'receptie_terminare',  label: 'Deblocare la recepție' },
  { val: 'finala',              label: 'Restituire finală' },
  { val: 'scrisoare_garantie',  label: 'Înlocuit cu scrisoare garanție' },
]

// ─── Badge helper ───────────────────────────────────────────────────────────
function Badge({ label, color, emoji }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700,
      background: (color || G.muted) + '22', color: color || G.muted,
      border: `1px solid ${(color || G.muted)}44`,
    }}>
      {emoji && <span>{emoji}</span>}{label}
    </span>
  )
}

// ─── Bară progres % realizat ─────────────────────────────────────────────────
function ProgresBar({ procent, compact }) {
  const p = procent == null ? 0 : Number(procent)
  const depasire = p > 100
  const fill = Math.min(p, 100)
  const culoare = depasire ? G.red : p >= 90 ? G.yellow : G.green
  return (
    <div style={{ minWidth: compact ? 90 : 130 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: compact ? 9 : 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>Realizat</span>
        <span style={{ fontSize: compact ? 11 : 12, fontWeight: 800, color: culoare }}>
          {procent == null ? '—' : `${p.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}%`}
          {depasire && ' ⚠️'}
        </span>
      </div>
      <div style={{ height: compact ? 5 : 6, borderRadius: 4, background: G.border2, overflow: 'hidden' }}>
        <div style={{ width: `${fill}%`, height: '100%', background: culoare, borderRadius: 4, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

// ─── Parser fișă cont 401 WinMentor (XLSX) ───────────────────────────────────
// Întoarce facturile (credit) ȘI plățile (debit, este_plata=true), cu semn păstrat
// (storno/corecții = negativ). Regularizările de curs (Reg/EchivLei) se exclud.
function parseNum(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  let s = String(v).trim().replace(/[^\d.,-]/g, '')
  if (!s) return 0
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.')
  if (lc > -1 && ld > -1) {
    if (lc > ld) s = s.replace(/\./g, '').replace(',', '.')   // RO: 99.027,32
    else s = s.replace(/,/g, '')                               // US: 99,027.32
  } else if (lc > -1) {
    const dec = s.length - lc - 1
    if (dec === 3) s = s.replace(/,/g, '')                     // 99,027 = mii
    else s = s.replace(',', '.')                               // 99,02 = zecimal
  }
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}
function normNume(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(srl-d|srl|s\.r\.l|sa|s\.a|pfa|snc|scs|sca|ii)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function numeMatch(furnizor, partener) {
  const a = normNume(furnizor), b = normNume(partener)
  if (!a || !b) return false
  if (a.includes(b) || b.includes(a)) return true
  const stop = new Set(['trans', 'design', 'instal', 'solutions', 'group', 'grup', 'construct', 'constructii', 'prod', 'com', 'impex', 'serv', 'service', 'services', 'romania', 'company', 'expert', 'tech'])
  const sig = t => t.length >= 3 && !stop.has(t)
  const tb = new Set(b.split(' ').filter(sig))
  return a.split(' ').filter(sig).some(t => tb.has(t))
}
// Match șantier din Observații WinMentor (ex. „ORSOVA LOT 1") contra numelui site-ului
// de pe contract. TOATE token-urile din observație trebuie să existe în numele site-ului
// — dezambiguizează „Lot 1" vs „Lot 2" și evită false-positives pe observații libere.
function siteMatch(obs, siteName) {
  const norm = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  const o = norm(obs), t = norm(siteName)
  if (!o || !t) return false
  const stop = new Set(['gazpet', 'transgaz', 'depogaz', 'habau', 'santier', 'lucrare', 'scadenta'])
  const tokens = o.split(' ').filter(w => w && !stop.has(w))
  if (tokens.length === 0) return false
  const tt = new Set(t.split(' '))
  return tokens.every(w => tt.has(w))
}
function parseFisaWinMentor(rows) {
  const facturi = []
  const reCtr = /(?:ctr|contract|anexa)\.?\s*(?:nr\.?)?\s*(\d{2,5})/i
  const reData = /^(\d{2})\.(\d{2})\.(\d{4})$/
  for (const r of (rows || [])) {
    if (!Array.isArray(r)) continue
    const colA = (r[0] ?? '').toString().trim().toLowerCase()
    if (colA.startsWith('total') || colA.replace(/\s/g, '').startsWith('total')) continue
    // Data: poate fi Date (cellDates) sau string DD.MM.YYYY
    let dataISO = null
    const dataCell = r[1]
    if (dataCell instanceof Date && !isNaN(dataCell)) {
      dataISO = `${dataCell.getFullYear()}-${String(dataCell.getMonth() + 1).padStart(2, '0')}-${String(dataCell.getDate()).padStart(2, '0')}`
    } else {
      const md = (dataCell ?? '').toString().trim().match(reData)
      if (!md) continue
      dataISO = `${md[3]}-${md[2]}-${md[1]}`
    }
    const tip = (r[2] ?? '').toString().trim()
    const numar = (r[3] ?? '').toString().trim()
    const credit = parseNum(r[10])
    const debit = parseNum(r[9])
    const valoareE = parseNum(r[4])
    const monedaRaw = (r[7] ?? '').toString().trim()
    const obs = (r[14] ?? '').toString().trim()
    const tipUp = tip.toUpperCase()
    // Regularizări de curs valutar (tip „Reg" / moneda „EchivLei") = ajustări FX lunare,
    // NU facturi/plăți reale — ar polua facturat/plătit cu sume false → skip
    if (/^REG/.test(tipUp) || /^echivlei$/i.test(monedaRaw)) continue
    const ePlata = /^(OP|CH|CHIT|PLAT|ORDIN|EXTRAS|PV)/.test(tipUp) || (debit > 0 && credit === 0)
    // Factură = credit (datoria crește); Plată (OP/PV) = debit (bani ieșiți).
    // Semnul se PĂSTREAZĂ: storno facturi (credit negativ) și corecții de plată
    // (PV trecut pe credit) intră cu minus — altfel totalurile ies umflate.
    let val = ePlata ? (debit - credit) : (credit - debit)
    if (val === 0) val = valoareE   // fallback pentru fișe fără coloane Debit/Credit
    if (val === 0) continue
    val = Math.round(val * 100) / 100
    // Fișe în valută: col. E = valoarea originală (EUR etc.), col. I = cursul
    const eValuta = monedaRaw !== '' && !/^(ron|lei)$/i.test(monedaRaw)
    const moneda = eValuta ? monedaRaw.toUpperCase() : 'RON'
    const valMoneda = eValuta ? Math.round((val < 0 ? -Math.abs(valoareE) : Math.abs(valoareE)) * 100) / 100 : null
    const curs = eValuta ? (parseNum(r[8]) || null) : null
    let refNr = null, refText = null
    const mc = obs.match(reCtr)
    if (mc) { refNr = mc[1]; refText = obs.slice(0, 80) }
    facturi.push({ tip_document: tip, numar_document: numar, data_document: dataISO, valoare_lei: val, moneda, valoare_moneda: valMoneda, curs, observatii: obs, ref_nr: refNr, ref_text: refText, este_plata: ePlata })
  }
  return facturi
}

// ─── Modal: vizualizare facturi alocate la un contract ───────────────────────
function FacturiModal({ contract, profile, onClose, onChanged }) {
  const [facturi, setFacturi] = useState([])
  const [loading, setLoading] = useState(true)
  const canManage = profile?.is_owner === true || profile?.can_manage_contracts === true

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data } = await supabase.from('contracte_subcontract_facturi')
      .select('*').eq('contract_id', contract.id).eq('alocat', true).order('data_document')
    setFacturi(data || [])
    setLoading(false)
  }
  async function dezaloca(id) {
    if (!confirm('Scoți factura de pe acest contract? Va reveni la „de confirmat".')) return
    await supabase.from('contracte_subcontract_facturi').update({ contract_id: null, alocat: false }).eq('id', id)
    load(); onChanged && onChanged()
  }

  const total = facturi.filter(f => !f.este_plata).reduce((s, f) => s + Number(f.valoare_lei || 0), 0)
  const totalPlatit = facturi.filter(f => f.este_plata).reduce((s, f) => s + Number(f.valoare_lei || 0), 0)
  const restDePlata = total - totalPlatit
  const nrFacturi = facturi.filter(f => !f.este_plata).length
  const valContract = Number(contract.valoare_lei || 0)
  // TVA: fișa 401 e CU TVA, contractul e FĂRĂ TVA → pentru % realizat și rămas de
  // facturat comparăm NET vs NET. Plătit/Rest de plată rămân CU TVA (cash-ul real).
  const netOf = f => Number(f.valoare_lei || 0) / (1 + Number(f.cota_tva ?? 21) / 100)
  const netEurOf = f => Number(f.valoare_moneda || 0) / (1 + Number(f.cota_tva ?? 21) / 100)
  const totalNet = facturi.filter(f => !f.este_plata).reduce((s, f) => s + netOf(f), 0)
  // Mod EUR: la contractele valutare, RON-ul contractului e la cursul SEMNĂRII iar
  // facturile la cursul emiterii → procentul în RON distorsionează. Calculăm în EUR.
  const valContractEur = Number(contract.valoare_eur || 0)
  const totalEur = facturi.filter(f => !f.este_plata && f.moneda && f.moneda !== 'RON').reduce((s, f) => s + Number(f.valoare_moneda || 0), 0)
  const platitEur = facturi.filter(f => f.este_plata && f.moneda && f.moneda !== 'RON').reduce((s, f) => s + Number(f.valoare_moneda || 0), 0)
  const totalNetEur = facturi.filter(f => !f.este_plata && f.moneda && f.moneda !== 'RON').reduce((s, f) => s + netEurOf(f), 0)
  const modEur = valContractEur > 0 && totalEur !== 0
  const procent = modEur ? (totalNetEur / valContractEur) * 100 : (valContract > 0 ? (totalNet / valContract) * 100 : null)
  const depasire = procent != null && procent > 100

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9001, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '88vh', overflowY: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>📄 Facturi subcontractor</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              Nr. {contract.numar_contract} — {(contract.denumire || '').slice(0, 55)}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* Sumar — Facturat/Rămas de facturat pe NET (comparabil cu contractul fără TVA);
            Plătit/Rest de plată CU TVA (cash real). La contracte valutare cifra mare e EUR. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 18 }}>
          {[
            modEur
              ? { label: 'Contractat', val: fmtEUR(valContractEur), color: G.text, sub: `fără TVA · ${fmtRON(valContract)}` }
              : { label: 'Contractat', val: fmtRON(valContract), color: G.text, sub: 'fără TVA' },
            modEur
              ? { label: 'Facturat (net)', val: fmtEUR(totalNetEur), color: G.green, sub: `${nrFacturi} facturi · cu TVA: ${fmtEUR(totalEur)}` }
              : { label: 'Facturat (net)', val: fmtRON(totalNet), color: G.green, sub: `${nrFacturi} facturi · cu TVA: ${fmtRON(total)}` },
            modEur
              ? { label: 'Plătit', val: fmtEUR(platitEur), color: G.blue, sub: `cu TVA · ${fmtRON(totalPlatit)}` }
              : { label: 'Plătit', val: fmtRON(totalPlatit), color: G.blue, sub: 'cu TVA' },
            modEur
              ? { label: 'Rest de plată', val: Math.abs(totalEur - platitEur) < 0.005 ? '0 €' : fmtEUR(totalEur - platitEur), color: (totalEur - platitEur) > 0.005 ? G.orange : G.green, sub: `cu TVA · ${fmtRON(restDePlata)}` }
              : { label: 'Rest de plată', val: Math.abs(restDePlata) < 0.005 ? '0 RON' : fmtRON(restDePlata), color: restDePlata > 0.005 ? G.orange : G.green, sub: 'cu TVA · facturat − plătit' },
            modEur
              ? { label: depasire ? '⚠️ Depășire' : 'Rămas de facturat', val: fmtEUR(Math.abs(valContractEur - totalNetEur)), color: depasire ? G.red : G.text, sub: 'fără TVA' }
              : { label: depasire ? '⚠️ Depășire' : 'Rămas de facturat', val: fmtRON(Math.abs(valContract - totalNet)), color: depasire ? G.red : G.text, sub: 'fără TVA' },
          ].map(k => (
            <div key={k.label} style={{ ...S.card, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label}</div>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: k.color, whiteSpace: 'nowrap' }}>{k.val}</div>
              {k.sub && <div style={{ fontSize: 9.5, color: G.dim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.sub}</div>}
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 18 }}><ProgresBar procent={procent} /></div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: G.muted }}>⏳ Se încarcă...</div>
        ) : facturi.length === 0 ? (
          <div style={{ ...S.card, padding: 30, textAlign: 'center', color: G.muted, fontSize: 13 }}>
            Nicio factură alocată. Folosește <b style={{ color: G.text }}>„📥 Import facturi"</b> din pagina principală.
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: G.muted, textAlign: 'left' }}>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>Document</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>Data</th>
                <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Valoare</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>Referință</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {facturi.map(f => (
                <tr key={f.id} style={{ borderTop: `1px solid ${G.border}`, color: G.text }}>
                  <td style={{ padding: '7px 4px' }}>
                    {f.tip_document} {f.numar_document}
                    {f.este_plata && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44` }}>💸 PLATĂ</span>}
                  </td>
                  <td style={{ padding: '7px 4px', color: G.muted }}>{f.data_document}</td>
                  <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600, color: f.este_plata ? G.blue : G.green }}>
                    {fmtRON(f.valoare_lei)}
                    {f.moneda && f.moneda !== 'RON' && f.valoare_moneda != null && (
                      <div style={{ fontSize: 10, fontWeight: 500, color: G.dim }}>
                        {Number(f.valoare_moneda).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} {f.moneda}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '7px 4px', color: G.dim, fontSize: 11 }}>{f.referinta_detectata || '—'}</td>
                  {canManage && (
                    <td style={{ padding: '7px 4px', textAlign: 'right' }}>
                      <button onClick={() => dezaloca(f.id)} title="Scoate de pe contract"
                        style={{ padding: '3px 8px', background: G.red + '22', color: G.red, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Modal: import fișă WinMentor (.xlsx) ────────────────────────────────────
function ImportFacturiModal({ contracte, profile, onClose, onDone }) {
  const [step, setStep] = useState(1)        // 1=upload, 2=review, 3=done
  const [fileName, setFileName] = useState('')
  const [furnizor, setFurnizor] = useState('')
  const [cotaSel, setCotaSel] = useState('auto')  // 'auto' (19/21 după dată) | '21' | '19' | '0'
  const [parsed, setParsed] = useState([])   // facturi parsate + matching
  const [saving, setSaving] = useState(false)
  const [rezultat, setRezultat] = useState(null)

  // contracte de PLATĂ (prestatori/subcontractori) — acolo se alocă facturi cont 401
  const contractePlata = useMemo(
    () => (contracte || []).filter(c => c.numar_contract && c.sens === 'plata').map(c => ({
      id: c.id, numar: c.numar_contract,
      partener: c.partener_text || c.beneficiar_name || c.denumire || '',
      site: c.site_name || '',
      label: `Nr. ${c.numar_contract} · ${(c.partener_text || c.beneficiar_name || c.denumire || '').slice(0, 40)}`,
    })),
    [contracte]
  )
  // dropdown: doar contractele prestatorului curent (după furnizor), fallback la toate de plată
  const optiuniContracte = useMemo(() => {
    if (!furnizor.trim()) return contractePlata
    const ale = contractePlata.filter(c => numeMatch(furnizor, c.partener))
    return ale.length > 0 ? ale : contractePlata
  }, [contractePlata, furnizor])
  const furnizorFaraMatch = furnizor.trim() && contractePlata.some(c => numeMatch(furnizor, c.partener)) === false

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
    const facturi = parseFisaWinMentor(rows)
    // contractele acestui furnizor — dacă are unul singur, alocăm automat tot (inclusiv OP-urile fără referință)
    const aleFurnizorului = furnizor.trim() ? contractePlata.filter(c => numeMatch(furnizor, c.partener)) : []
    const singurContract = aleFurnizorului.length === 1 ? aleFurnizorului[0].id : null
    // furnizor cu MAI MULTE contracte: încercăm alocarea după șantierul din Observații
    const candidati = aleFurnizorului.length > 0 ? aleFurnizorului : contractePlata
    const enriched = facturi.map((f, i) => {
      let contractId = null
      if (f.ref_nr) {
        const hit = contractePlata.find(o => String(o.numar) === String(f.ref_nr))
        if (hit) contractId = hit.id
      }
      // Observațiile din fișa 401 conțin adesea șantierul (ex. „BILCIURESTI", „ORSOVA LOT 1")
      // → match unic contra site-ului contractelor candidate
      if (!contractId && f.observatii) {
        const peSite = candidati.filter(o => siteMatch(f.observatii, o.site))
        if (peSite.length === 1) contractId = peSite[0].id
      }
      if (!contractId && singurContract) contractId = singurContract
      return { ...f, _idx: i, contract_id: contractId, alocat: !!contractId }
    })
    setParsed(enriched)
    setStep(2)
  }

  function setContractFor(idx, contractId) {
    setParsed(prev => prev.map(f => f._idx === idx
      ? { ...f, contract_id: contractId ? Number(contractId) : null, alocat: !!contractId }
      : f))
  }

  const facturiList = parsed.filter(f => !f.este_plata)
  const platiList = parsed.filter(f => f.este_plata)
  const cuRef = parsed.filter(f => f.contract_id)
  const faraRef = parsed.filter(f => !f.contract_id)
  const sumaFacturi = facturiList.reduce((s, f) => s + Number(f.valoare_lei || 0), 0)
  const sumaPlati = platiList.reduce((s, f) => s + Number(f.valoare_lei || 0), 0)

  async function salveaza() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    // 1. audit import
    const { data: imp } = await supabase.from('contracte_subcontract_import').insert({
      fisier_nume: fileName, furnizor_text: furnizor || null,
      total_randuri: parsed.length, facturi_total: facturiList.length,
      facturi_alocate: cuRef.length, facturi_nealocate: faraRef.length,
      suma_facturi_lei: sumaFacturi, imported_by: user?.id || null,
    }).select().single()

    // 2. facturi + plăți — ignoreDuplicates: rândurile deja existente (după cheia unică)
    //    NU se ating la re-import, ca să nu suprascriem alocările făcute manual/anterior
    const rows = parsed.map(f => ({
      contract_id: f.contract_id, furnizor_text: furnizor || null,
      tip_document: f.tip_document, numar_document: f.numar_document,
      data_document: f.data_document, valoare_lei: f.valoare_lei,
      moneda: f.moneda || 'RON', valoare_moneda: f.valoare_moneda ?? null, curs: f.curs ?? null,
      cota_tva: cotaSel === 'auto' ? cotaTvaLaData(f.data_document) : Number(cotaSel),
      observatii_winmentor: f.observatii, referinta_detectata: f.ref_text,
      alocat: f.alocat, este_plata: !!f.este_plata, sursa: 'winmentor_xls', import_id: imp?.id || null,
      created_by: user?.id || null,
    }))
    const { error } = await supabase.from('contracte_subcontract_facturi')
      .upsert(rows, { onConflict: 'furnizor_text,tip_document,numar_document,data_document,valoare_lei', ignoreDuplicates: true })
    setSaving(false)
    if (error) { alert('Eroare la salvare: ' + error.message); return }
    setRezultat({ total: parsed.length, alocate: cuRef.length, nealocate: faraRef.length })
    setStep(3)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9001, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, width: '100%', maxWidth: 820, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>📥 Import facturi furnizor (Cont 401) din WinMentor</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>Fișa contului 401 — facturi + plăți (OP/PV). Regularizările de curs se exclud automat; la re-import rândurile existente nu se ating.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* STEP 1 — upload */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Furnizor (subcontractor)</label>
              <input value={furnizor} onChange={e => setFurnizor(e.target.value)}
                placeholder="ex: NDT TECHNICAL EXAMINATION" style={S.input} />
              <div style={{ fontSize: 11, color: G.dim, marginTop: 4 }}>
                Numele furnizorului din fișa WinMentor. Folosit la dedup (aceeași factură nu se dublează la re-import).
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Cota TVA inclusă în fișă</label>
              <select value={cotaSel} onChange={e => setCotaSel(e.target.value)} style={S.select}>
                <option value="auto" style={{ background: G.surface }}>Automat după dată (19% până la 31.07.2025, 21% după)</option>
                <option value="21" style={{ background: G.surface }}>21% (standard actual)</option>
                <option value="19" style={{ background: G.surface }}>19% (standard vechi)</option>
                <option value="0" style={{ background: G.surface }}>0% — fără TVA / taxare inversă / neplătitor</option>
              </select>
              <div style={{ fontSize: 11, color: G.dim, marginTop: 4 }}>
                Fișa 401 e cu TVA inclus, contractele sunt fără TVA — cota e folosită la calculul net pentru % realizat și rămas de facturat.
              </div>
            </div>
            <DropZone
              onFile={handleFile}
              accept=".xlsx,.xls"
              icon="📊"
              color={G.green}
              label="Trage fișa XLSX aici sau click"
              hint={'Export „Fișă cont 401" din WinMentor'}
            />
          </div>
        )}

        {/* STEP 2 — review */}
        {step === 2 && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Facturi (Cont 401)', val: facturiList.length, color: G.blue },
                { label: 'Plăți (OP)', val: platiList.length, color: G.purple },
                { label: 'De confirmat', val: faraRef.length, color: faraRef.length > 0 ? G.yellow : G.muted },
                { label: 'Sumă facturi', val: fmtRON(sumaFacturi), color: G.text },
                { label: 'Sumă plătită', val: fmtRON(sumaPlati), color: G.green },
              ].map(k => (
                <div key={k.label} style={{ ...S.card, padding: '8px 14px', flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{k.val}</div>
                </div>
              ))}
            </div>

            {furnizorFaraMatch && (
              <div style={{ padding: '8px 12px', background: G.blue + '15', border: `1px solid ${G.blue}44`, borderRadius: 8, fontSize: 12, color: G.blue, marginBottom: 12 }}>
                ℹ️ „{furnizor}" nu se potrivește cu niciun contract de plată — în dropdown apar toate contractele de prestare. Verifică numele furnizorului dacă te aștepți la potrivire automată.
              </div>
            )}
            {parsed.length === 0 ? (
              <div style={{ ...S.card, padding: 24, textAlign: 'center', color: G.muted, fontSize: 13 }}>
                Nicio factură detectată în fișă. Verifică formatul (export „Fișă cont 401").
              </div>
            ) : (
              <div style={{ maxHeight: '46vh', overflowY: 'auto', border: `1px solid ${G.border}`, borderRadius: 8 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: G.bg, color: G.muted, textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Document</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Data</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Valoare</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Observații WinMentor</th>
                      <th style={{ padding: '8px 6px', fontWeight: 600 }}>Alocare contract</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map(f => (
                      <tr key={f._idx} style={{ borderTop: `1px solid ${G.border}`, color: G.text, background: f.contract_id ? 'transparent' : G.yellow + '11' }}>
                        <td style={{ padding: '7px 6px', whiteSpace: 'nowrap' }}>
                          {f.tip_document} {f.numar_document}
                          {f.este_plata && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: G.purple + '22', color: G.purple, border: `1px solid ${G.purple}44` }}>💸 PLATĂ</span>}
                        </td>
                        <td style={{ padding: '7px 6px', color: G.muted, whiteSpace: 'nowrap' }}>{f.data_document}</td>
                        <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 600 }}>
                          {fmtRON(f.valoare_lei)}
                          {f.moneda && f.moneda !== 'RON' && f.valoare_moneda != null && (
                            <div style={{ fontSize: 10, fontWeight: 500, color: G.dim }}>
                              {Number(f.valoare_moneda).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} {f.moneda}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '7px 6px', color: G.dim, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.observatii}>
                          {f.observatii || <span style={{ color: G.yellow }}>(fără observație)</span>}
                        </td>
                        <td style={{ padding: '7px 6px' }}>
                          <select value={f.contract_id || ''} onChange={e => setContractFor(f._idx, e.target.value)}
                            style={{
                              ...S.select, width: 200, padding: '5px 8px', fontSize: 11,
                              background: G.bg, color: f.contract_id ? G.text : G.yellow,
                              border: `1px solid ${f.contract_id ? G.border : G.yellow}`,
                            }}>
                            <option value="" style={{ background: G.surface, color: G.yellow }}>⚠️ Nealocată</option>
                            {optiuniContracte.map(o => <option key={o.id} value={o.id} style={{ background: G.surface, color: G.text }}>{o.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {faraRef.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: G.yellow + '15', border: `1px solid ${G.yellow}44`, borderRadius: 8, fontSize: 12, color: G.yellow }}>
                ⚠️ {faraRef.length} {faraRef.length === 1 ? 'factură rămâne nealocată' : 'facturi rămân nealocate'}. Alege contractul din dropdown sau lasă-le nealocate (le confirmi mai târziu — nu intră în % până le aloci).
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
              <button onClick={() => { setStep(1); setParsed([]) }} style={{ ...S.btnP, background: G.surface, border: `1px solid ${G.border}`, color: G.muted }}>← Înapoi</button>
              <button onClick={salveaza} disabled={saving || parsed.length === 0}
                style={{ ...S.btnP, opacity: (saving || parsed.length === 0) ? 0.5 : 1, cursor: (saving || parsed.length === 0) ? 'not-allowed' : 'pointer' }}>
                {saving ? '⏳ Se salvează...' : `💾 Salvează ${parsed.length} facturi`}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — done */}
        {step === 3 && rezultat && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text, marginBottom: 8 }}>Import finalizat</div>
            <div style={{ fontSize: 13, color: G.muted, marginBottom: 6 }}>
              {rezultat.total} facturi procesate · {rezultat.alocate} alocate · {rezultat.nealocate} de confirmat
            </div>
            <div style={{ fontSize: 11, color: G.dim, marginBottom: 18 }}>
              (Re-importul aceleiași fișe nu dublează — facturile existente se actualizează.)
            </div>
            <button onClick={onDone} style={{ ...S.btnP }}>Gata</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Card contract ──────────────────────────────────────────────────────────
function ContractCard({ c, isOwner, canManage, onEdit, onViewLinii, onViewFacturi, onViewActe, onViewGBE, onViewPdf, onChangeStatus, isMama, nrCopii, totalCopii, totalFacturatCopii, collapsed, onToggleCollapse }) {
  const tip = TIP_META[c.tip_contract]
  const rol = ROL_META[c.rol_gazpet]
  const st  = STATUS_META[c.status] || STATUS_META.draft
  const isDownstream = c.sens === 'plata'


  return (
    <div style={{
      ...S.card, padding: '14px 18px', marginBottom: 8,
      borderLeft: `3px solid ${isMama ? G.blue : (isDownstream ? G.purple : G.blue)}`,
      ...(isMama ? {
        background: 'linear-gradient(180deg, #15233D 0%, #131A2A 100%)',
        border: `1px solid ${G.blue}66`,
        borderLeft: `4px solid ${G.blue}`,
        boxShadow: `0 0 0 1px ${G.blue}22`,
      } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Buton roll-up/down pentru contractul mamă */}
        {isMama && (
          <button onClick={() => onToggleCollapse(c.id)}
            title={collapsed ? 'Arată subcontractele' : 'Ascunde subcontractele'}
            style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0, marginTop: 4,
              background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}55`,
              cursor: 'pointer', fontSize: 14, fontWeight: 800, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            {collapsed ? '▸' : '▾'}
          </button>
        )}

        {/* Icon sens */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: (isDownstream ? G.purple : G.blue) + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          {isDownstream ? '🔽' : '🔼'}
        </div>

        {/* Conținut */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: G.text }}>
              {c.numar_contract ? `Nr. ${c.numar_contract}` : '—'}
            </span>
            {isMama && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 800,
                background: G.orange + '26', color: G.orange, border: `1px solid ${G.orange}66`,
              }}>
                🔗 {nrCopii} {nrCopii === 1 ? 'subcontract' : 'subcontracte'}{collapsed ? ` · ${fmtRON(totalCopii)}` : ''}
              </span>
            )}
            <Badge label={st.label} color={st.color} />
            {tip && <Badge label={tip.label} color={tip.color} emoji={tip.emoji} />}
            {rol && <Badge label={rol.label} color={rol.color} />}
            {/* Alerte critice */}
            {isDownstream && !c.contract_parinte_id && (
              <Badge label="⚠️ Fără contract mamă" color={G.red} />
            )}
            {c.data_termen && new Date(c.data_termen) < new Date() && (
              <Badge label="❌ Expirat" color={G.red} />
            )}
            {c.data_termen && new Date(c.data_termen) > new Date() &&
             new Date(c.data_termen) < new Date(Date.now() + 30*24*3600*1000) && (
              <Badge label="⏳ Expiră în 30 zile" color={G.yellow} />
            )}
            {c.nr_pret_depasit_neaprobat > 0 && (
              <Badge label={`⚠️ ${c.nr_pret_depasit_neaprobat} preț depășit`} color={G.red} />
            )}
            {/* Alerte GBE */}
            {(() => {
              const ramas = Number(c._gbe?.gbe_ramas || 0)
              const zRec = ramas > 0.5 ? zileRamase(c.gbe_data_estimata_recuperare) : null
              const zPol = c._politaExpZile
              return (
                <>
                  {zRec != null && zRec <= 60 && (
                    <Badge label={zRec < 0 ? '🔐 GBE recuperare depășită' : `🔐 GBE recuperabil ${zRec}z`} color={zRec <= 30 ? G.red : G.yellow} />
                  )}
                  {zPol != null && zPol <= 60 && (
                    <Badge label={zPol < 0 ? '🏦 Poliță expirată' : `🏦 Poliță expiră ${zPol}z`} color={zPol <= 30 ? G.red : G.yellow} />
                  )}
                </>
              )
            })()}
          </div>

          <div style={{ fontSize: 13, color: G.text, fontWeight: 600, marginBottom: 4, lineHeight: 1.4, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
            {c.denumire}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: G.muted }}>
            {(c.beneficiar_name || c.partener_text) && (
              <span>👤 {c.beneficiar_name || c.partener_text}</span>
            )}
            {c.site_qr && <span title={(c.santiere_nume || []).join(' · ')}>📍 {c.site_qr}{(c.santiere_ids?.length > 1) ? ` +${c.santiere_ids.length - 1}` : ''}</span>}
            {c.data_semnare && <span>📅 {c.data_semnare}</span>}
            {c.termen_plata_zile && <span>⏱️ {c.termen_plata_zile}z plată</span>}
            {c.garantie_buna_executie_pct && <span>🔐 GBE {c.garantie_buna_executie_pct}%</span>}
            {c.parinte_numar && (
              <span style={{ color: G.purple }}>🔗 din contract nr. {c.parinte_numar}</span>
            )}
          </div>


        </div>

        {/* Valoare + acțiuni */}
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: isDownstream ? G.red : G.green }}>
            {isDownstream ? '↑' : '↓'} {fmtRON(c.valoare_lei)}
          </div>
          {Number(c.valoare_eur || 0) > 0 && (
            <div style={{ fontSize: 12, fontWeight: 700, color: G.muted }} title="Valoare contract în valută">
              💶 {fmtEUR(c.valoare_eur)}
            </div>
          )}
          {c.valoare_cu_acte != null && Number(c.valoare_cu_acte) !== Number(c.valoare_lei || 0) && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: G.purple }} title="Valoarea actuală cu actele adiționale aplicate (din ambele module)">
              ⚡ cu acte: {fmtRON(c.valoare_cu_acte)}
            </div>
          )}
          {c.nr_acte_aditionale > 0 && (
            <button onClick={() => onViewActe(c)} title="Vezi / gestionează actele adiționale"
              style={{ fontSize: 13, fontWeight: 700, color: G.purple, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              +{c.nr_acte_aditionale} acte adiționale
            </button>
          )}

          {isMama && (
            <div style={{ fontSize: 11, lineHeight: 1.6, textAlign: 'right', padding: '6px 10px', background: G.bg, borderRadius: 8, border: `1px solid ${G.border}` }}>
              <div style={{ color: G.orange }}>− Subcontractat: <b>{fmtRON(totalCopii)}</b></div>
              <div style={{ color: G.green, fontWeight: 700 }}>= Rămas Gazpet: {fmtRON(Number(c.valoare_lei || 0) - (totalCopii || 0))}</div>
              <div style={{ color: G.muted, marginTop: 2, paddingTop: 2, borderTop: `1px solid ${G.border}` }} title="Cât mai au subcontractorii de facturat (cont 401)">
                Rămas de facturat subc.: <b style={{ color: G.text }}>{fmtRON((totalCopii || 0) - (totalFacturatCopii || 0))}</b>
              </div>
            </div>
          )}

          {/* Bară % realizat */}
          <ProgresBar procent={c.procent_realizat} />

          {/* Quick status (owner/manager) */}
          {canManage && (
            <select value={c.status} onChange={e => onChangeStatus(c, e.target.value)}
              title="Schimbă status contract"
              style={{
                padding: '3px 6px', fontSize: 11, fontWeight: 700, borderRadius: 5,
                background: (st.color) + '22', color: st.color, border: `1px solid ${st.color}44`,
                cursor: 'pointer', outline: 'none', colorScheme: 'dark',
              }}>
              <option value="activ" style={{ background: G.surface, color: G.text }}>Activ</option>
              <option value="suspendat" style={{ background: G.surface, color: G.text }}>Suspendat</option>
              <option value="finalizat" style={{ background: G.surface, color: G.text }}>Închis</option>
              <option value="draft" style={{ background: G.surface, color: G.text }}>Draft</option>
              <option value="reziliat" style={{ background: G.surface, color: G.text }}>Reziliat</option>
            </select>
          )}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2, flexWrap: 'wrap' }}>
            <button onClick={() => onViewFacturi(c)} style={{
              padding: '5px 10px', background: G.green + '22', color: G.green,
              border: `1px solid ${G.green}44`, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
            }}>📄 Facturi ({c.nr_facturi_subc || 0})</button>
            <button onClick={() => onViewLinii(c)} style={{
              padding: '5px 10px', background: G.blue + '22', color: G.blue,
              border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
            }}>📋 Linii ({c.nr_linii})</button>
            <button onClick={() => onViewActe(c)} title="Acte adiționale" style={{
              padding: '5px 10px', background: G.purple + '22', color: G.purple,
              border: `1px solid ${G.purple}44`, borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
            }}>⚡ Acte ({c.nr_acte_aditionale || 0})</button>
            {(Number(c.garantie_buna_executie_pct) > 0 || c.gbe_tip || c._gbe || c._nrPolite > 0) && (
              <button onClick={() => onViewGBE(c)} title="Evidență GBE (garanție bună execuție)" style={{
                padding: '5px 10px', background: G.yellow + '22', color: G.yellow,
                border: `1px solid ${G.yellow}44`, borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
              }}>🔐 GBE{c._gbe?.gbe_ramas > 0 ? ` (${fmtRON(c._gbe.gbe_ramas)})` : ''}</button>
            )}
            {c.pdf_path && (
              <button onClick={() => onViewPdf(c)} title="Vezi PDF contract" style={{
                padding: '5px 10px', background: G.text + '18', color: G.text,
                border: `1px solid ${G.border}`, borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
              }}>📎 PDF</button>
            )}
            {(isOwner || canManage) && (
              <button onClick={() => onEdit(c)} style={{
                padding: '5px 10px', background: G.orange + '22', color: G.orange,
                border: `1px solid ${G.orange}44`, borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
              }}>✏️</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal contract nou/editare ─────────────────────────────────────────────
function ModalContract({ contract, contracteUpstream, sites, beneficiari, profile, onClose, onSaved }) {
  const isEdit = !!contract?.id
  const isOwner = profile?.is_owner === true

  const [form, setForm] = useState({
    numar_contract: contract?.numar_contract || '',
    denumire: contract?.denumire || '',
    tip_contract: contract?.tip_contract || 'subcontractare',
    rol_gazpet: contract?.rol_gazpet || '',
    sens: contract?.sens || 'incasare',
    status: contract?.status || 'draft',
    valoare_lei: contract?.valoare_lei || '',
    valoare_eur: contract?.valoare_eur || '',
    data_semnare: contract?.data_semnare || '',
    data_termen: contract?.data_termen || '',
    termen_plata_zile: contract?.termen_plata_zile || '',
    garantie_buna_executie_pct: contract?.garantie_buna_executie_pct || '',
    gbe_tip: contract?.gbe_tip || 'retinere',
    gbe_pct_deblocare_receptie: contract?.gbe_pct_deblocare_receptie ?? 70,
    gbe_pct_deblocare_final: contract?.gbe_pct_deblocare_final ?? 30,
    garantie_perioada_luni: contract?.garantie_perioada_luni || '',
    gbe_data_estimata_recuperare: contract?.gbe_data_estimata_recuperare || '',
    gbe_observatii: contract?.gbe_observatii || '',
    contract_parinte_id: contract?.contract_parinte_id || '',
    site_id: contract?.site_id || '',
    santiere_ids: contract?.santiere_ids?.map(Number) || (contract?.site_id ? [Number(contract.site_id)] : []),
    beneficiar_id: contract?.beneficiar_id || '',
    partener_text: contract?.partener_text || '',
    observatii: contract?.observatii || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pdfPath, setPdfPath] = useState(contract?.pdf_path || '')

  async function handlePdfSelect(file) {
    if (!file) return
    if (!file.type.includes('pdf')) { setErr('Doar fișiere PDF.'); return }
    if (file.size > 20 * 1024 * 1024) { setErr('PDF prea mare (max 20MB).'); return }
    setPdfFile(file)
  }

  async function uploadPdf(contractId) {
    if (!pdfFile) return pdfPath || null
    setPdfUploading(true)
    try {
      const ext = 'pdf'
      const path = `contracte-comerciale/${contractId}_${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('contracte-terti').upload(path, pdfFile, { upsert: true, contentType: 'application/pdf' })
      if (error) throw error
      setPdfPath(path)
      return path
    } catch (e) {
      setErr('Eroare upload PDF: ' + e.message)
      return null
    } finally { setPdfUploading(false) }
  }

  async function handleViewPdf() {
    if (!pdfPath) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(pdfPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const rolDisponibile = ROLURI_PER_TIP[form.tip_contract] || []

  // Când se schimbă tipul, resetăm rolul
  function handleTipChange(tip) {
    const roluri = ROLURI_PER_TIP[tip] || []
    setForm(f => ({ ...f, tip_contract: tip, rol_gazpet: roluri[0] || '' }))
  }

  async function handleSave() {
    if (!form.denumire.trim()) { setErr('Denumirea contractului este obligatorie.'); return }
    if (!form.tip_contract)   { setErr('Selectează tipul contractului.'); return }
    if (form.sens === 'incasare' && !form.rol_gazpet) { setErr('Selectează rolul Gazpet.'); return }
    setSaving(true); setErr('')
    try {
      // Upload PDF dacă e selectat
      let finalPdfPath = pdfPath
      if (pdfFile) {
        const tempId = isEdit ? contract.id : Date.now()
        finalPdfPath = await uploadPdf(tempId)
        if (!finalPdfPath && pdfFile) { setSaving(false); return }
      }
      const payload = {
        numar_contract: form.numar_contract || null,
        denumire: form.denumire.trim(),
        tip_contract: form.tip_contract,
        rol_gazpet: form.sens === 'plata' ? (form.rol_gazpet || 'prestator') : form.rol_gazpet,
        sens: form.sens,
        status: form.status,
        categorie: 'executie',
        valoare_lei: form.valoare_lei ? Number(form.valoare_lei) : null,
        valoare_eur: form.valoare_eur ? Number(form.valoare_eur) : null,
        data_semnare: form.data_semnare || null,
        data_termen: form.data_termen || null,
        termen_plata_zile: form.termen_plata_zile ? Number(form.termen_plata_zile) : null,
        garantie_buna_executie_pct: form.garantie_buna_executie_pct ? Number(form.garantie_buna_executie_pct) : null,
        gbe_tip: form.gbe_tip || null,
        gbe_pct_deblocare_receptie: form.gbe_pct_deblocare_receptie !== '' ? Number(form.gbe_pct_deblocare_receptie) : null,
        gbe_pct_deblocare_final: form.gbe_pct_deblocare_final !== '' ? Number(form.gbe_pct_deblocare_final) : null,
        garantie_perioada_luni: form.garantie_perioada_luni ? Number(form.garantie_perioada_luni) : null,
        gbe_data_estimata_recuperare: form.gbe_data_estimata_recuperare || null,
        gbe_observatii: form.gbe_observatii || null,
        contract_parinte_id: form.contract_parinte_id ? Number(form.contract_parinte_id) : null,
        site_id: form.santiere_ids[0] || (form.site_id ? Number(form.site_id) : null),
        santiere_ids: form.santiere_ids.length ? form.santiere_ids : null,
        beneficiar_id: form.beneficiar_id ? Number(form.beneficiar_id) : null,
        partener_text: form.partener_text || null,
        observatii: form.observatii || null,
        pdf_path: finalPdfPath || null,
        updated_at: new Date().toISOString(),
      }
      if (isEdit) {
        const { error } = await supabase.from('contracte_terti').update(payload).eq('id', contract.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contracte_terti').insert({ ...payload, created_at: new Date().toISOString() })
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Eroare salvare.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
        padding: 28,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>
            {isEdit ? '✏️ Editează Contract' : '➕ Contract Comercial Nou'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* TIP CONTRACT */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Tip Contract</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(TIP_META)
              // Downstream: asocierea nu se aplică; Upstream: furnizarea de materiale nu se aplică (Gazpet nu vinde materiale)
              .filter(([key]) => form.sens === 'incasare' ? key !== 'furnizare_materiale' : key !== 'asociere')
              .map(([key, meta]) => (
                <button key={key} onClick={() => handleTipChange(key)} style={{
                  flex: 1, padding: '12px 8px', border: `2px solid ${form.tip_contract === key ? meta.color : G.border}`,
                  borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  background: form.tip_contract === key ? meta.color + '22' : G.bg,
                  color: form.tip_contract === key ? meta.color : G.muted,
                  fontWeight: 700, fontSize: 12, transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{meta.emoji}</div>
                  {meta.label}
                </button>
              ))}
          </div>
        </div>

        {/* ROL GAZPET — doar la upstream (downstream = Gazpet e mereu constructor general) */}
        {form.sens === 'incasare' && (
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Rolul Gazpet</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {rolDisponibile.map(rol => {
                const meta = ROL_META[rol]
                return (
                  <button key={rol} onClick={() => setForm(f => ({ ...f, rol_gazpet: rol }))} style={{
                    padding: '8px 14px', border: `2px solid ${form.rol_gazpet === rol ? meta.color : G.border}`,
                    borderRadius: 8, cursor: 'pointer',
                    background: form.rol_gazpet === rol ? meta.color + '22' : G.bg,
                    color: form.rol_gazpet === rol ? meta.color : G.muted,
                    fontWeight: 700, fontSize: 12,
                  }}>
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {form.sens === 'plata' && (
          <div style={{ marginBottom: 20, padding: '8px 14px', background: G.green + '11', borderRadius: 8, border: `1px solid ${G.green}33` }}>
            <span style={{ fontSize: 12, color: G.green, fontWeight: 700 }}>
              🏗️ Rolul Gazpet: Constructor General (implicit pentru toate contractele cu prestatori)
            </span>
          </div>
        )}

        {/* SENS */}
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Sens Financiar</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: 'incasare', label: '🔼 Upstream — Gazpet execută (încasează)', color: G.green },
              { val: 'plata',    label: '🔽 Downstream — Contract cu prestator (plătim)', color: G.purple },
            ].map(s => (
              <button key={s.val} onClick={() => setForm(f => ({ ...f, sens: s.val }))} style={{
                flex: 1, padding: '10px 12px', border: `2px solid ${form.sens === s.val ? s.color : G.border}`,
                borderRadius: 8, cursor: 'pointer',
                background: form.sens === s.val ? s.color + '22' : G.bg,
                color: form.sens === s.val ? s.color : G.muted,
                fontWeight: 700, fontSize: 12, textAlign: 'center',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* CONTRACT PARINTE (doar dacă sens=plata) */}
        {form.sens === 'plata' && (
          <div style={{ marginBottom: 20, padding: 14, background: G.purple + '11', borderRadius: 10, border: `1px solid ${G.purple}33` }}>
            <label style={{ ...S.label, color: G.purple }}>🔗 Contract Upstream (din care derivă)</label>
            <select value={form.contract_parinte_id} onChange={e => {
              const pid = e.target.value
              // Auto-populare șantier din contractul parinte
              const parinte = contracteUpstream.find(c => String(c.id) === String(pid))
              setForm(f => {
                const pSite = parinte?.site_id ? Number(parinte.site_id) : null
                const arr = pSite && !f.santiere_ids.includes(pSite) ? [...f.santiere_ids, pSite] : f.santiere_ids
                return { ...f, contract_parinte_id: pid, santiere_ids: arr, site_id: arr[0] ? String(arr[0]) : f.site_id }
              })
            }} style={S.select}>
              <option value="">— Selectează contractul principal —</option>
              {contracteUpstream.map(c => (
                <option key={c.id} value={c.id}>
                  Nr. {c.numar_contract} — {c.denumire?.slice(0, 90)}{c.denumire?.length > 90 ? '…' : ''}
                </option>
              ))}
            </select>
            {form.contract_parinte_id && contracteUpstream.find(c => String(c.id) === String(form.contract_parinte_id))?.site_qr && (
              <div style={{ marginTop: 6, fontSize: 11, color: G.purple }}>
                📍 Șantier auto-completat: {contracteUpstream.find(c => String(c.id) === String(form.contract_parinte_id))?.site_qr}
              </div>
            )}
          </div>
        )}

        {/* GRID CÂMPURI */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={S.label}>Număr Contract</label>
            <input value={form.numar_contract} onChange={e => setForm(f => ({ ...f, numar_contract: e.target.value }))} placeholder="ex: 70/2024" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={S.select}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Denumire Contract *</label>
          <textarea value={form.denumire} onChange={e => setForm(f => ({ ...f, denumire: e.target.value }))}
            placeholder="Denumirea completă a contractului..."
            rows={2} style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* Beneficiar sau Partener */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>{form.sens === 'incasare' ? 'Beneficiar' : 'Prestator / Partener'}</label>
            {form.sens === 'incasare' ? (
              <select value={form.beneficiar_id} onChange={e => setForm(f => ({ ...f, beneficiar_id: e.target.value }))} style={S.select}>
                <option value="">— Selectează —</option>
                {beneficiari.map(b => <option key={b.id} value={b.id}>{b.nume}</option>)}
              </select>
            ) : (
              <input value={form.partener_text} onChange={e => setForm(f => ({ ...f, partener_text: e.target.value }))}
                placeholder="Denumire firmă prestator..." style={S.input} />
            )}
          </div>
          <div>
            <label style={S.label}>Șantiere deservite (click pentru selectare multiplă)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8, maxHeight: 130, overflowY: 'auto' }}>
              {sites.map(s => {
                const on = form.santiere_ids.includes(Number(s.id))
                return (
                  <button key={s.id} type="button" onClick={() => setForm(f => {
                    const arr = f.santiere_ids.includes(Number(s.id))
                      ? f.santiere_ids.filter(x => x !== Number(s.id))
                      : [...f.santiere_ids, Number(s.id)]
                    return { ...f, santiere_ids: arr, site_id: arr[0] ? String(arr[0]) : '' }
                  })} style={{
                    padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: on ? G.blue + '33' : 'transparent', color: on ? G.blue : G.muted,
                    border: `1px solid ${on ? G.blue : G.border}`,
                  }}>{on ? '✓ ' : ''}{s.denumire_qr || s.name}</button>
                )
              })}
            </div>
            {form.santiere_ids.length > 1 && (
              <div style={{ fontSize: 10, color: G.blue, marginTop: 4 }}>📍 Contract multi-șantier: {form.santiere_ids.length} șantiere — se descarcă pe lucrări prin comenzi furnizor</div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Valoare Contract (RON)</label>
            <input type="number" value={form.valoare_lei} onChange={e => setForm(f => ({ ...f, valoare_lei: e.target.value }))}
              placeholder="0" style={S.input} />
          </div>
          <div>
            <label style={S.label}>💶 Valoare Contract (EUR)</label>
            <input type="number" value={form.valoare_eur} onChange={e => setForm(f => ({ ...f, valoare_eur: e.target.value }))}
              placeholder="0" style={S.input} />
            <div style={{ fontSize: 10, color: G.dim, marginTop: 3 }}>Doar la contracte în valută — activează modul EUR în facturi / % realizat.</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Termen Plată (zile)</label>
            <input type="number" value={form.termen_plata_zile} onChange={e => setForm(f => ({ ...f, termen_plata_zile: e.target.value }))}
              placeholder="30" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Termen recuperare GBE (estimat)</label>
            <input type="date" value={form.gbe_data_estimata_recuperare} onChange={e => setForm(f => ({ ...f, gbe_data_estimata_recuperare: e.target.value }))} style={S.input} />
          </div>
        </div>

        {/* ─── RUBRICĂ GBE ─────────────────────────────────────────────── */}
        {(() => {
          const sumaPct = Number(form.gbe_pct_deblocare_receptie || 0) + Number(form.gbe_pct_deblocare_final || 0)
          const sumaOk = !form.gbe_pct_deblocare_receptie && !form.gbe_pct_deblocare_final ? true : Math.abs(sumaPct - 100) < 0.01
          return (
            <div style={{ marginBottom: 20, padding: 16, background: G.bg, borderRadius: 10, border: `1px solid ${G.border}` }}>
              <label style={{ ...S.label, marginBottom: 10 }}>🔐 Garanție Bună Execuție (GBE)</label>

              {/* Tip GBE */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {Object.entries(GBE_TIP_META).map(([key, meta]) => (
                  <button key={key} type="button" onClick={() => setForm(f => ({ ...f, gbe_tip: key }))} style={{
                    flex: 1, padding: '10px 8px', border: `2px solid ${form.gbe_tip === key ? meta.color : G.border}`,
                    borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                    background: form.gbe_tip === key ? meta.color + '22' : G.surface,
                    color: form.gbe_tip === key ? meta.color : G.muted,
                    fontWeight: 700, fontSize: 12,
                  }}>
                    <span style={{ marginRight: 6 }}>{meta.emoji}</span>{meta.label}
                  </button>
                ))}
              </div>

              {/* REȚINERE: procente */}
              {form.gbe_tip === 'retinere' && (
                <>
                  <div style={{ fontSize: 11, color: G.dim, marginBottom: 10, lineHeight: 1.5 }}>
                    Reținerile se constituie automat din liniile de tip „reținere" ale situațiilor de lucrări (IPC). Aici definești doar parametrii pentru evidență și deblocări.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                    <div>
                      <label style={S.label}>GBE % din Valoare</label>
                      <input type="number" value={form.garantie_buna_executie_pct} onChange={e => setForm(f => ({ ...f, garantie_buna_executie_pct: e.target.value }))}
                        placeholder="10" style={S.input} />
                    </div>
                    <div>
                      <label style={S.label}>Perioadă valabilitate (luni)</label>
                      <input type="number" value={form.garantie_perioada_luni} onChange={e => setForm(f => ({ ...f, garantie_perioada_luni: e.target.value }))}
                        placeholder="24" style={S.input} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 8 }}>
                    <div>
                      <label style={S.label}>% deblocare la recepție</label>
                      <input type="number" value={form.gbe_pct_deblocare_receptie} onChange={e => setForm(f => ({ ...f, gbe_pct_deblocare_receptie: e.target.value }))}
                        placeholder="70" style={S.input} />
                    </div>
                    <div>
                      <label style={S.label}>% deblocare final valabilitate</label>
                      <input type="number" value={form.gbe_pct_deblocare_final} onChange={e => setForm(f => ({ ...f, gbe_pct_deblocare_final: e.target.value }))}
                        placeholder="30" style={S.input} />
                    </div>
                  </div>
                  {!sumaOk && (
                    <div style={{ fontSize: 11, color: G.yellow, fontWeight: 600 }}>
                      ⚠️ Procentele de deblocare însumează {sumaPct}% (recomandat 100%).
                    </div>
                  )}
                </>
              )}

              {/* POLIȚĂ: hint */}
              {form.gbe_tip === 'polita' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
                  <div>
                    <label style={S.label}>Perioadă valabilitate (luni)</label>
                    <input type="number" value={form.garantie_perioada_luni} onChange={e => setForm(f => ({ ...f, garantie_perioada_luni: e.target.value }))}
                      placeholder="24" style={S.input} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', fontSize: 11, color: G.blue, background: G.blue + '11', border: `1px solid ${G.blue}33`, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
                    🏦 Polițele (scrisori de garanție) se adaugă din <b>🔐 Evidență GBE</b> pe card, după salvarea contractului — pot fi mai multe (inițială + reînnoiri), cu alertă de expirare.
                  </div>
                </div>
              )}

              {/* Observații GBE — comun */}
              <div style={{ marginTop: 12 }}>
                <label style={S.label}>Observații GBE</label>
                <input value={form.gbe_observatii} onChange={e => setForm(f => ({ ...f, gbe_observatii: e.target.value }))}
                  placeholder="ex: deblocare 70% la PV recepție, 30% după 24 luni" style={S.input} />
              </div>
            </div>
          )
        })()}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Data Semnare</label>
            <input type="date" value={form.data_semnare} onChange={e => setForm(f => ({ ...f, data_semnare: e.target.value }))} style={S.input} />
          </div>
          <div>
            <label style={S.label}>Termen Execuție</label>
            <input type="date" value={form.data_termen} onChange={e => setForm(f => ({ ...f, data_termen: e.target.value }))} style={S.input} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Observații</label>
          <textarea value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))}
            placeholder="Note interne..." rows={2} style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* PDF UPLOAD */}
        <div style={{ marginBottom: 20, padding: 14, background: G.bg, borderRadius: 10, border: `1px solid ${G.border}` }}>
          <label style={S.label}>📎 PDF Contract</label>
          {pdfPath && !pdfFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: G.green }}>✅ PDF atașat</span>
              <button onClick={handleViewPdf} style={{
                padding: '4px 10px', background: G.blue + '22', color: G.blue,
                border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              }}>👁 Vezi PDF</button>
            </div>
          )}
          {pdfFile && (
            <div style={{ marginBottom: 8, fontSize: 12, color: G.yellow }}>
              📄 {pdfFile.name} ({(pdfFile.size/1024/1024).toFixed(1)} MB) — se uploadează la salvare
            </div>
          )}
          <DropZone
            onFile={handlePdfSelect}
            accept="application/pdf"
            icon="📤"
            compact
            disabled={pdfUploading}
            label={pdfUploading ? 'Se uploadează...' : (pdfPath ? 'Înlocuiește PDF — trage sau click' : 'Trage PDF aici sau click')}
            hint="PDF, max 20MB"
          />
        </div>

        {err && (
          <div style={{ padding: '10px 14px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            ⚠️ {err}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{
            padding: '9px 18px', background: 'transparent', color: G.muted,
            border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13,
          }}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            ...S.btnP, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer',
          }}>
            {saving ? '⏳ Se salvează...' : isEdit ? '✅ Salvează' : '✅ Adaugă Contract'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Linii Contract ────────────────────────────────────────────────────
function ModalLinii({ contract, profile, onClose }) {
  const [linii, setLinii] = useState([])
  const [loading, setLoading] = useState(true)
  const [newLinie, setNewLinie] = useState({ denumire: '', unitate_masura: '', cantitate: '', pret_unitar: '' })
  const [saving, setSaving] = useState(false)
  const isOwner = profile?.is_owner === true
  const canEdit = isOwner || profile?.can_manage_contracts === true

  useEffect(() => { loadLinii() }, [])

  async function loadLinii() {
    setLoading(true)
    const { data } = await supabase.from('contracte_linii')
      .select('*').eq('contract_id', contract.id).order('pozitie')
    setLinii(data || [])
    setLoading(false)
  }

  async function addLinie() {
    if (!newLinie.denumire || !newLinie.pret_unitar) return
    setSaving(true)
    const { error } = await supabase.from('contracte_linii').insert({
      contract_id: contract.id,
      pozitie: linii.length,
      denumire: newLinie.denumire,
      unitate_masura: newLinie.unitate_masura || null,
      cantitate: newLinie.cantitate ? Number(newLinie.cantitate) : null,
      pret_unitar: Number(newLinie.pret_unitar),
    })
    if (!error) {
      setNewLinie({ denumire: '', unitate_masura: '', cantitate: '', pret_unitar: '' })
      loadLinii()
    }
    setSaving(false)
  }

  async function deleteLinie(id) {
    if (!confirm('Ștergi linia?')) return
    await supabase.from('contracte_linii').delete().eq('id', id)
    loadLinii()
  }

  const totalValoare = linii.reduce((s, l) => s + Number(l.valoare_totala || 0), 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9001, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 780, maxHeight: '88vh', overflowY: 'auto', padding: 28,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>📋 Linii Contract</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              Nr. {contract.numar_contract} — {contract.denumire?.slice(0, 60)}...
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {/* Tabel linii */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: G.muted }}>⏳ Se încarcă...</div>
        ) : linii.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: G.muted, background: G.bg, borderRadius: 10, marginBottom: 16 }}>
            Nicio linie adăugată încă.
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: G.bg }}>
                  {['Denumire', 'UM', 'Cantitate', 'Preț/UM', 'Valoare', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: G.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', borderBottom: `1px solid ${G.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linii.map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${G.border2}` }}>
                    <td style={{ padding: '8px 10px', color: G.text, fontWeight: 600 }}>
                      {l.denumire}
                      {l.pret_depasit && !l.pret_depasit_aprobat_de && (
                        <span style={{ marginLeft: 6, color: G.red, fontSize: 10, fontWeight: 700 }}>⚠️ Preț depășit</span>
                      )}
                      {l.pret_depasit && l.pret_depasit_aprobat_de && (
                        <span style={{ marginLeft: 6, color: G.green, fontSize: 10, fontWeight: 700 }}>✅ Aprobat</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: G.muted }}>{l.unitate_masura || '—'}</td>
                    <td style={{ padding: '8px 10px', color: G.muted }}>{l.cantitate != null ? l.cantitate : '—'}</td>
                    <td style={{ padding: '8px 10px', color: G.text }}>{Number(l.pret_unitar).toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: '8px 10px', color: G.green, fontWeight: 700 }}>{Number(l.valoare_totala).toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: '8px 10px' }}>
                      {isOwner && (
                        <button onClick={() => deleteLinie(l.id)} style={{
                          padding: '3px 8px', background: G.red + '22', color: G.red,
                          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        }}>🗑</button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: G.bg }}>
                  <td colSpan={4} style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: G.muted, fontSize: 12 }}>TOTAL</td>
                  <td style={{ padding: '10px', fontWeight: 800, color: G.green, fontSize: 14 }}>{totalValoare.toLocaleString('ro-RO')} RON</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Adaugă linie nouă */}
        {canEdit && (
          <div style={{ ...S.card, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, marginBottom: 12 }}>➕ Adaugă linie</div>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={S.label}>Denumire *</label>
                <input value={newLinie.denumire} onChange={e => setNewLinie(n => ({ ...n, denumire: e.target.value }))}
                  placeholder="ex: Nisip sort 0-4" style={S.input} />
              </div>
              <div>
                <label style={S.label}>UM</label>
                <input value={newLinie.unitate_masura} onChange={e => setNewLinie(n => ({ ...n, unitate_masura: e.target.value }))}
                  placeholder="mc, t, ml..." style={S.input} />
              </div>
              <div>
                <label style={S.label}>Cantitate</label>
                <input type="number" value={newLinie.cantitate} onChange={e => setNewLinie(n => ({ ...n, cantitate: e.target.value }))}
                  placeholder="—" style={S.input} />
              </div>
              <div>
                <label style={S.label}>Preț/UM (RON) *</label>
                <input type="number" value={newLinie.pret_unitar} onChange={e => setNewLinie(n => ({ ...n, pret_unitar: e.target.value }))}
                  placeholder="0" style={S.input} />
              </div>
              <button onClick={addLinie} disabled={saving || !newLinie.denumire || !newLinie.pret_unitar} style={{
                ...S.btnP, opacity: (saving || !newLinie.denumire || !newLinie.pret_unitar) ? 0.5 : 1,
                cursor: (saving || !newLinie.denumire || !newLinie.pret_unitar) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}>
                {saving ? '⏳' : '+ Adaugă'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Dashboard alerte contracte ─────────────────────────────────────────────
function AlerteDashboard({ contracte, onFilterSens, onFilterStatus, onOpenGbe }) {
  const azi = new Date()
  const in30z = new Date(Date.now() + 30 * 24 * 3600 * 1000)

  const faraParinte  = contracte.filter(c => c.sens === 'plata' && !c.contract_parinte_id)
  const expirate     = contracte.filter(c => c.data_termen && new Date(c.data_termen) < azi && c.status === 'activ')
  const expiraCurand = contracte.filter(c => c.data_termen && new Date(c.data_termen) >= azi && new Date(c.data_termen) <= in30z && c.status === 'activ')
  const inDraft      = contracte.filter(c => c.status === 'draft')

  // GBE: polițe care expiră ≤60z + GBE de recuperat ≤60z (sortate după urgență)
  const politeExp = contracte
    .filter(c => c._politaExpZile != null && c._politaExpZile <= 60)
    .sort((a, b) => a._politaExpZile - b._politaExpZile)
  const gbeRecup = contracte
    .filter(c => Number(c._gbe?.gbe_ramas || 0) > 0.5)
    .map(c => ({ c, z: zileRamase(c.gbe_data_estimata_recuperare) }))
    .filter(x => x.z != null && x.z <= 60)
    .sort((a, b) => a.z - b.z)

  const alerte = [
    expirate.length     && { icon: '❌', label: `${expirate.length} contract${expirate.length > 1 ? 'e' : ''} expirat${expirate.length > 1 ? 'e' : ''}`, color: G.red,    action: () => onFilterStatus('activ') },
    expiraCurand.length && { icon: '⏳', label: `${expiraCurand.length} expiră în 30 zile`, color: G.yellow, action: () => onFilterStatus('activ') },
    faraParinte.length  && { icon: '🔗', label: `${faraParinte.length} fără contract mamă`, color: G.orange, action: () => onFilterSens('plata') },
    inDraft.length      && { icon: '📋', label: `${inDraft.length} draft${inDraft.length > 1 ? '-uri' : ''} nesemnate`, color: G.muted, action: () => onFilterStatus('draft') },
    politeExp.length    && { icon: '🏦', label: `${politeExp.length} poliță GBE expiră curând`, color: politeExp[0]._politaExpZile <= 30 ? G.red : G.yellow, action: () => onOpenGbe && onOpenGbe(politeExp[0]) },
    gbeRecup.length     && { icon: '🔐', label: `${gbeRecup.length} GBE de recuperat (${fmtRON(gbeRecup.reduce((s, x) => s + Number(x.c._gbe.gbe_ramas || 0), 0))})`, color: gbeRecup[0].z <= 30 ? G.red : G.yellow, action: () => onOpenGbe && onOpenGbe(gbeRecup[0].c) },
  ].filter(Boolean)

  if (!alerte.length) return null

  return (
    <div style={{
      ...S.card, marginBottom: 16, padding: '12px 16px',
      borderColor: G.red + '44', borderTopWidth: 3, borderTopColor: G.red,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: G.red, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        🔔 Alerte Contracte
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {alerte.map((a, i) => (
          <button key={i} onClick={a.action} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', background: a.color + '15',
            border: `1px solid ${a.color}44`, borderRadius: 8,
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: a.color,
          }}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Componentă principală ──────────────────────────────────────────────────
// ─── Modal Acte Adiționale ───────────────────────────────────────────────────
const TIP_ACT_OPTS = ['Valoare', 'Termen', 'Valoare + Termen', 'Alte clauze']

function ActForm({ contract, act, onCancel, onSaved }) {
  const isEdit = !!act?.id
  const [form, setForm] = useState({
    numar_act: act?.numar_act || '',
    data_semnare: act?.data_semnare || '',
    tip: act?.tip || 'Valoare',
    valoare_noua_lei: act?.valoare_noua_lei ?? '',
    valoare_noua_eur: act?.valoare_noua_eur ?? '',
    durata_noua_zile: act?.durata_noua_zile ?? '',
    data_termen_noua: act?.data_termen_noua || '',
    observatii: act?.observatii || '',
  })
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfPath, setPdfPath] = useState(act?.pdf_path || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handlePdfSelect(file) {
    if (!file) return
    if (!file.type.includes('pdf')) { setErr('Doar fișiere PDF.'); return }
    if (file.size > 20 * 1024 * 1024) { setErr('PDF prea mare (max 20MB).'); return }
    setPdfFile(file); setErr('')
  }

  async function handleViewPdf() {
    if (!pdfPath) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(pdfPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleSave() {
    if (!form.numar_act.trim()) { setErr('Numărul actului e obligatoriu.'); return }
    setSaving(true); setErr('')
    try {
      let finalPdfPath = pdfPath
      if (pdfFile) {
        const path = `acte-aditionale/${contract.id}_${Date.now()}.pdf`
        const { error: upErr } = await supabase.storage.from('contracte-terti').upload(path, pdfFile, { upsert: true, contentType: 'application/pdf' })
        if (upErr) throw new Error('Upload PDF: ' + upErr.message)
        finalPdfPath = path
      }
      const payload = {
        contract_id: contract.id,
        numar_act: form.numar_act.trim(),
        data_semnare: form.data_semnare || null,
        tip: form.tip || null,
        valoare_noua_lei: form.valoare_noua_lei !== '' ? Number(form.valoare_noua_lei) : null,
        valoare_noua_eur: form.valoare_noua_eur !== '' ? Number(form.valoare_noua_eur) : null,
        durata_noua_zile: form.durata_noua_zile !== '' ? Number(form.durata_noua_zile) : null,
        data_termen_noua: form.data_termen_noua || null,
        observatii: form.observatii || null,
        pdf_path: finalPdfPath || null,
        updated_at: new Date().toISOString(),
      }
      if (isEdit) {
        const { error } = await supabase.from('contracte_acte_aditionale').update(payload).eq('id', act.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contracte_acte_aditionale').insert(payload)
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Eroare salvare.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: G.bg, border: `1px solid ${G.purple}55`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: G.purple, marginBottom: 12 }}>{isEdit ? '✏️ Editează act adițional' : '➕ Act adițional nou'}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Număr act *</label>
          <input value={form.numar_act} onChange={e => setForm(f => ({ ...f, numar_act: e.target.value }))} placeholder="ex: AA1/2025" style={S.input} />
        </div>
        <div>
          <label style={S.label}>Data semnare</label>
          <input type="date" value={form.data_semnare} onChange={e => setForm(f => ({ ...f, data_semnare: e.target.value }))} style={S.input} />
        </div>
        <div>
          <label style={S.label}>Tip</label>
          <select value={form.tip} onChange={e => setForm(f => ({ ...f, tip: e.target.value }))} style={S.select}>
            {TIP_ACT_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Valoare nouă totală (RON)</label>
          <input type="number" value={form.valoare_noua_lei} onChange={e => setForm(f => ({ ...f, valoare_noua_lei: e.target.value }))} placeholder="gol dacă nu modifică" style={S.input} />
        </div>
        <div>
          <label style={S.label}>💶 Valoare nouă totală (EUR)</label>
          <input type="number" value={form.valoare_noua_eur} onChange={e => setForm(f => ({ ...f, valoare_noua_eur: e.target.value }))} placeholder="doar la contracte în valută" style={S.input} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Termen nou execuție</label>
          <input type="date" value={form.data_termen_noua} onChange={e => setForm(f => ({ ...f, data_termen_noua: e.target.value }))} style={S.input} />
        </div>
        <div>
          <label style={S.label}>Durată nouă (zile)</label>
          <input type="number" value={form.durata_noua_zile} onChange={e => setForm(f => ({ ...f, durata_noua_zile: e.target.value }))} placeholder="opțional" style={S.input} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Observații</label>
        <textarea value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))} rows={2} placeholder="Ce modifică actul..." style={{ ...S.input, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>📎 PDF act adițional</label>
        {pdfPath && !pdfFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: G.green }}>✅ PDF atașat</span>
            <button onClick={handleViewPdf} style={{ padding: '4px 10px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>👁 Vezi</button>
          </div>
        )}
        {pdfFile && <div style={{ marginBottom: 6, fontSize: 12, color: G.yellow }}>📄 {pdfFile.name} — se uploadează la salvare</div>}
        <DropZone onFile={handlePdfSelect} accept="application/pdf" icon="📤" compact
          label={pdfPath ? 'Înlocuiește PDF — trage sau click' : 'Trage PDF aici sau click'} hint="PDF, max 20MB" />
      </div>

      {err && <div style={{ padding: '8px 12px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠️ {err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Anulează</button>
        <button onClick={handleSave} disabled={saving} style={{ ...S.btnP, background: G.purple, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '⏳...' : (isEdit ? '✅ Salvează' : '✅ Adaugă')}</button>
      </div>
    </div>
  )
}

function ModalActeAditionale({ contract, profile, canManage, onClose, onChanged }) {
  const isOwner = profile?.is_owner === true
  const [acte, setActe] = useState([])
  const [loading, setLoading] = useState(true)
  const [editAct, setEditAct] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('contracte_acte_aditionale')
      .select('*')
      .eq('contract_id', contract.id)
      .order('data_semnare', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
    setActe(data || [])
    setLoading(false)
  }

  // Actul „în vigoare" pe valoare = cel mai recent cu valoare_noua_lei setată (logica view-ului)
  const actInVigoareId = useMemo(() => (acte.find(x => x.valoare_noua_lei != null)?.id || null), [acte])

  async function handleViewActPdf(path) {
    if (!path) return
    const { data, error } = await supabase.storage.from('contracte-terti').createSignedUrl(path, 120)
    if (error || !data?.signedUrl) { alert('Nu am putut deschide PDF-ul.'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleDelete(act) {
    if (!window.confirm(`Ștergi „${act.numar_act}"? Acțiunea e ireversibilă.`)) return
    const { error } = await supabase.from('contracte_acte_aditionale').delete().eq('id', act.id)
    if (error) { alert('Eroare ștergere: ' + error.message); return }
    if (act.pdf_path) await supabase.storage.from('contracte-terti').remove([act.pdf_path])
    await load(); onChanged && onChanged()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9100, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>⚡ Acte adiționale</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              {contract.numar_contract ? `Nr. ${contract.numar_contract} · ` : ''}{(contract.denumire || '').slice(0, 70)}{(contract.denumire || '').length > 70 ? '…' : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: 11.5, color: G.dim, marginBottom: 16, padding: '8px 12px', background: G.bg, borderRadius: 8, border: `1px solid ${G.border}` }}>
          ℹ️ „Valoarea nouă totală" e valoarea contractului DUPĂ act (nu diferența). Ultimul act semnat cu valoare setată determină valoarea actuală a contractului.
        </div>

        {canManage && !adding && !editAct && (
          <button onClick={() => setAdding(true)} style={{ ...S.btnP, background: G.purple, marginBottom: 16 }}>
            + Act adițional nou
          </button>
        )}

        {(adding || editAct) && canManage && (
          <ActForm
            contract={contract}
            act={editAct}
            onCancel={() => { setAdding(false); setEditAct(null) }}
            onSaved={async () => { setAdding(false); setEditAct(null); await load(); onChanged && onChanged() }}
          />
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 30, color: G.muted }}>⏳ Se încarcă...</div>
        ) : acte.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: G.muted, fontSize: 13 }}>Niciun act adițional încă.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {acte.map(a => (
              <div key={a.id} style={{ ...S.card, padding: '12px 14px', borderLeft: `3px solid ${a.id === actInVigoareId ? G.green : G.purple}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: G.text }}>{a.numar_act}</span>
                      {a.tip && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 5, background: G.purple + '22', color: G.purple, fontWeight: 700 }}>{a.tip}</span>}
                      {a.id === actInVigoareId && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 5, background: G.green + '22', color: G.green, fontWeight: 700 }}>✓ în vigoare</span>}
                      {a.data_semnare && <span style={{ fontSize: 11, color: G.muted }}>📅 {a.data_semnare}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: G.muted }}>
                      {a.valoare_noua_lei != null && <span style={{ color: G.green, fontWeight: 700 }}>💰 Val. nouă: {fmtRON(a.valoare_noua_lei)}</span>}
                      {Number(a.valoare_noua_eur || 0) > 0 && <span style={{ color: G.muted, fontWeight: 700 }}>💶 {fmtEUR(a.valoare_noua_eur)}</span>}
                      {a.data_termen_noua && <span>⏳ Termen nou: {a.data_termen_noua}</span>}
                      {a.durata_noua_zile != null && <span>📆 Durată: {a.durata_noua_zile} zile</span>}
                    </div>
                    {a.observatii && <div style={{ fontSize: 11.5, color: G.dim, marginTop: 4 }}>{a.observatii}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {a.pdf_path && (
                      <button onClick={() => handleViewActPdf(a.pdf_path)} title="Vezi PDF act" style={{ padding: '4px 9px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📎 PDF</button>
                    )}
                    {canManage && (
                      <button onClick={() => { setEditAct(a); setAdding(false) }} style={{ padding: '4px 9px', background: G.orange + '22', color: G.orange, border: `1px solid ${G.orange}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✏️</button>
                    )}
                    {isOwner && (
                      <button onClick={() => handleDelete(a)} title="Șterge act (doar owner)" style={{ padding: '4px 9px', background: G.red + '22', color: G.red, border: `1px solid ${G.red}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>🗑</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══ GBE — Formular restituire (inline) ════════════════════════════════════
function RestituireFormGBE({ contract, restituire, onCancel, onSaved }) {
  const isEdit = !!restituire?.id
  const [form, setForm] = useState({
    data_restituire: restituire?.data_restituire || new Date().toISOString().slice(0, 10),
    valoare_lei: restituire?.valoare_lei ?? '',
    tip: restituire?.tip || 'partiala',
    observatii: restituire?.observatii || '',
  })
  const [docFile, setDocFile] = useState(null)
  const [docPath, setDocPath] = useState(restituire?.document_path || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleDocSelect(file) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { setErr('Fișier prea mare (max 20MB).'); return }
    setDocFile(file); setErr('')
  }
  async function handleViewDoc() {
    if (!docPath) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(docPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleSave() {
    if (!form.data_restituire) { setErr('Data restituirii e obligatorie.'); return }
    if (!(Number(form.valoare_lei) > 0)) { setErr('Valoarea trebuie să fie > 0.'); return }
    setSaving(true); setErr('')
    try {
      let finalDoc = docPath
      if (docFile) {
        const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `gbe/${contract.id}/restituire_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('contracte-terti').upload(path, docFile, { upsert: true })
        if (upErr) throw new Error('Upload document: ' + upErr.message)
        finalDoc = path
      }
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        contract_id: contract.id,
        data_restituire: form.data_restituire,
        valoare_lei: Number(form.valoare_lei),
        tip: form.tip,
        observatii: form.observatii || null,
        document_path: finalDoc || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('gbe_restituiri').update(payload).eq('id', restituire.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('gbe_restituiri').insert({ ...payload, created_by: user?.id || null })
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Eroare salvare.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: G.bg, border: `1px solid ${G.green}55`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: G.green, marginBottom: 12 }}>{isEdit ? '✏️ Editează restituire' : '➕ Înregistrează restituire GBE'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Data restituire *</label>
          <input type="date" value={form.data_restituire} onChange={e => setForm(f => ({ ...f, data_restituire: e.target.value }))} style={S.input} />
        </div>
        <div>
          <label style={S.label}>Valoare (RON) *</label>
          <input type="number" value={form.valoare_lei} onChange={e => setForm(f => ({ ...f, valoare_lei: e.target.value }))} placeholder="0" style={S.input} />
        </div>
        <div>
          <label style={S.label}>Tip</label>
          <select value={form.tip} onChange={e => setForm(f => ({ ...f, tip: e.target.value }))} style={S.select}>
            {GBE_RESTITUIRE_TIP.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Observații</label>
        <input value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))} placeholder="ex: deblocare la PV recepție nr. ..." style={S.input} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>📎 Document (PV / ordin de plată)</label>
        {docPath && !docFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: G.green }}>✅ Document atașat</span>
            <button onClick={handleViewDoc} style={{ padding: '4px 10px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>👁 Vezi</button>
          </div>
        )}
        {docFile && <div style={{ marginBottom: 6, fontSize: 12, color: G.yellow }}>📄 {docFile.name} — se uploadează la salvare</div>}
        <DropZone onFile={handleDocSelect} accept="application/pdf,image/*" icon="📤" compact
          label={docPath ? 'Înlocuiește document — trage sau click' : 'Trage document aici sau click'} hint="PDF / imagine, max 20MB" />
      </div>
      {err && <div style={{ padding: '8px 12px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Anulează</button>
        <button onClick={handleSave} disabled={saving} style={{ ...S.btnP, background: G.green, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '⏳...' : (isEdit ? '✅ Salvează' : '✅ Înregistrează')}</button>
      </div>
    </div>
  )
}

// ═══ GBE — Formular poliță (inline) ═════════════════════════════════════════
function PolitaFormGBE({ contract, polita, onCancel, onSaved }) {
  const isEdit = !!polita?.id
  const [form, setForm] = useState({
    numar_polita: polita?.numar_polita || '',
    emitent: polita?.emitent || '',
    valoare_lei: polita?.valoare_lei ?? '',
    data_emitere: polita?.data_emitere || '',
    data_expirare: polita?.data_expirare || '',
    observatii: polita?.observatii || '',
    activ: polita?.activ ?? true,
  })
  const [docFile, setDocFile] = useState(null)
  const [docPath, setDocPath] = useState(polita?.document_path || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function handleDocSelect(file) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { setErr('Fișier prea mare (max 20MB).'); return }
    setDocFile(file); setErr('')
  }
  async function handleViewDoc() {
    if (!docPath) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(docPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleSave() {
    if (!form.numar_polita.trim() && !form.emitent.trim()) { setErr('Completează cel puțin numărul poliței sau emitentul.'); return }
    setSaving(true); setErr('')
    try {
      let finalDoc = docPath
      if (docFile) {
        const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `gbe/${contract.id}/polita_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('contracte-terti').upload(path, docFile, { upsert: true })
        if (upErr) throw new Error('Upload document: ' + upErr.message)
        finalDoc = path
      }
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        contract_id: contract.id,
        numar_polita: form.numar_polita.trim() || null,
        emitent: form.emitent.trim() || null,
        valoare_lei: form.valoare_lei !== '' ? Number(form.valoare_lei) : null,
        data_emitere: form.data_emitere || null,
        data_expirare: form.data_expirare || null,
        observatii: form.observatii || null,
        activ: !!form.activ,
        document_path: finalDoc || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('gbe_polite').update(payload).eq('id', polita.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('gbe_polite').insert({ ...payload, created_by: user?.id || null })
        if (error) throw error
      }
      onSaved()
    } catch (e) {
      setErr(e.message || 'Eroare salvare.')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ background: G.bg, border: `1px solid ${G.blue}55`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: G.blue, marginBottom: 12 }}>{isEdit ? '✏️ Editează poliță' : '➕ Poliță / scrisoare de garanție'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Număr poliță</label>
          <input value={form.numar_polita} onChange={e => setForm(f => ({ ...f, numar_polita: e.target.value }))} placeholder="ex: SG-12345/2025" style={S.input} />
        </div>
        <div>
          <label style={S.label}>Emitent (bancă / asigurător)</label>
          <input value={form.emitent} onChange={e => setForm(f => ({ ...f, emitent: e.target.value }))} placeholder="ex: BCR / Allianz" style={S.input} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={S.label}>Valoare (RON)</label>
          <input type="number" value={form.valoare_lei} onChange={e => setForm(f => ({ ...f, valoare_lei: e.target.value }))} placeholder="0" style={S.input} />
        </div>
        <div>
          <label style={S.label}>Data emitere</label>
          <input type="date" value={form.data_emitere} onChange={e => setForm(f => ({ ...f, data_emitere: e.target.value }))} style={S.input} />
        </div>
        <div>
          <label style={S.label}>Data expirare</label>
          <input type="date" value={form.data_expirare} onChange={e => setForm(f => ({ ...f, data_expirare: e.target.value }))} style={S.input} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Observații</label>
        <input value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii: e.target.value }))} placeholder="ex: reînnoire poliță inițială ..." style={S.input} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: G.text, cursor: 'pointer' }}>
        <input type="checkbox" checked={form.activ} onChange={e => setForm(f => ({ ...f, activ: e.target.checked }))} />
        Poliță activă (debifează când e expirată / înlocuită de reînnoire)
      </label>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>📎 Document poliță</label>
        {docPath && !docFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: G.green }}>✅ Document atașat</span>
            <button onClick={handleViewDoc} style={{ padding: '4px 10px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>👁 Vezi</button>
          </div>
        )}
        {docFile && <div style={{ marginBottom: 6, fontSize: 12, color: G.yellow }}>📄 {docFile.name} — se uploadează la salvare</div>}
        <DropZone onFile={handleDocSelect} accept="application/pdf,image/*" icon="📤" compact
          label={docPath ? 'Înlocuiește document — trage sau click' : 'Trage document aici sau click'} hint="PDF / imagine, max 20MB" />
      </div>
      {err && <div style={{ padding: '8px 12px', background: G.red + '22', color: G.red, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Anulează</button>
        <button onClick={handleSave} disabled={saving} style={{ ...S.btnP, background: G.blue, opacity: saving ? 0.6 : 1, cursor: saving ? 'wait' : 'pointer' }}>{saving ? '⏳...' : (isEdit ? '✅ Salvează' : '✅ Adaugă poliță')}</button>
      </div>
    </div>
  )
}

// ═══ GBE — Modal evidență per contract ══════════════════════════════════════
function ModalGBE({ contract, profile, canManage, onClose, onChanged }) {
  const [gbe, setGbe] = useState(null)
  const [restituiri, setRestituiri] = useState([])
  const [polite, setPolite] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState(null)        // null | 'restituire' | 'polita'
  const [editItem, setEditItem] = useState(null)

  const tipMeta = GBE_TIP_META[contract.gbe_tip] || GBE_TIP_META.retinere
  const isPolita = contract.gbe_tip === 'polita'

  useEffect(() => { loadData() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true)
    const [{ data: gbeRow }, { data: rest }, { data: pol }] = await Promise.all([
      supabase.from('v_gbe_per_contract').select('*').eq('contract_id', contract.id).maybeSingle(),
      supabase.from('gbe_restituiri').select('*').eq('contract_id', contract.id).order('data_restituire', { ascending: false }),
      supabase.from('gbe_polite').select('*').eq('contract_id', contract.id).order('data_emitere', { ascending: false, nullsFirst: false }),
    ])
    setGbe(gbeRow || null)
    setRestituiri(rest || [])
    setPolite(pol || [])
    setLoading(false)
  }

  async function handleViewDoc(path) {
    if (!path) return
    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function handleDeleteRestituire(id) {
    if (!window.confirm('Ștergi această restituire? Acțiune ireversibilă.')) return
    const { error } = await supabase.from('gbe_restituiri').delete().eq('id', id)
    if (error) { alert('Eroare ștergere: ' + error.message); return }
    await loadData(); onChanged && onChanged()
  }
  async function handleDeletePolita(id) {
    if (!window.confirm('Ștergi această poliță? Acțiune ireversibilă.')) return
    const { error } = await supabase.from('gbe_polite').delete().eq('id', id)
    if (error) { alert('Eroare ștergere: ' + error.message); return }
    await loadData(); onChanged && onChanged()
  }

  const retinut    = Number(gbe?.gbe_retinut || 0)
  const restituit  = Number(gbe?.gbe_restituit || 0)
  const ramas      = gbe?.gbe_ramas != null ? Number(gbe.gbe_ramas) : (retinut - restituit)
  const pctRestit  = retinut > 0 ? Math.min(100, (restituit / retinut) * 100) : 0
  const pctRec     = Number(contract.gbe_pct_deblocare_receptie ?? 70)
  const pctFin     = Number(contract.gbe_pct_deblocare_final ?? 30)
  const deblocRec  = ramas > 0 ? ramas * (pctRec / 100) : 0
  const deblocFin  = ramas > 0 ? ramas * (pctFin / 100) : 0
  const politeActive = polite.filter(p => p.activ)
  const politaTotal  = politeActive.reduce((s, p) => s + Number(p.valoare_lei || 0), 0)

  // Alerte
  const zRecup = zileRamase(contract.gbe_data_estimata_recuperare)
  const nivelRecup = ramas > 0.5 ? nivelAlertaZile(zRecup) : null
  const politaExp = politeActive
    .map(p => ({ ...p, _z: zileRamase(p.data_expirare) }))
    .filter(p => p._z != null && p._z <= 60)
    .sort((a, b) => a._z - b._z)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>🔐 Evidență GBE</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>
              {contract.numar_contract ? `Nr. ${contract.numar_contract} · ` : ''}{contract.denumire?.slice(0, 80)}{contract.denumire?.length > 80 ? '…' : ''}
            </div>
            <div style={{ marginTop: 8 }}>
              <Badge label={tipMeta.label} color={tipMeta.color} emoji={tipMeta.emoji} />
              {contract.garantie_buna_executie_pct ? <span style={{ marginLeft: 8, fontSize: 11, color: G.muted }}>GBE {contract.garantie_buna_executie_pct}%</span> : null}
              {contract.garantie_perioada_luni ? <span style={{ marginLeft: 8, fontSize: 11, color: G.muted }}>· valabilitate {contract.garantie_perioada_luni} luni</span> : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: G.muted }}>⏳ Se încarcă evidența GBE...</div>
        ) : (
          <>
            {/* Alerte */}
            {(nivelRecup || politaExp.length > 0) && (
              <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nivelRecup && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                    background: (nivelRecup === 'critic' ? G.red : G.yellow) + '18',
                    color: nivelRecup === 'critic' ? G.red : G.yellow,
                    border: `1px solid ${(nivelRecup === 'critic' ? G.red : G.yellow)}44` }}>
                    {zRecup < 0
                      ? `⏰ GBE de recuperat de la beneficiar — termen depășit cu ${Math.abs(zRecup)} zile (${fmtRON(ramas)})`
                      : `⏰ GBE de recuperat în ${zRecup} zile (${fmtRON(ramas)})`}
                  </div>
                )}
                {politaExp.map(p => (
                  <div key={p.id} style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                    background: (p._z <= 30 ? G.red : G.yellow) + '18',
                    color: p._z <= 30 ? G.red : G.yellow,
                    border: `1px solid ${(p._z <= 30 ? G.red : G.yellow)}44` }}>
                    {p._z < 0
                      ? `🏦 Poliță ${p.numar_polita || p.emitent || ''} EXPIRATĂ de ${Math.abs(p._z)} zile — reînnoiește, ești descoperit pe garanție`
                      : `🏦 Poliță ${p.numar_polita || p.emitent || ''} expiră în ${p._z} zile — reînnoiește, altfel rămâi descoperit`}
                  </div>
                ))}
              </div>
            )}

            {/* Card sume */}
            <div style={{ ...S.card, padding: 18, marginBottom: 18, background: G.bg }}>
              {isPolita ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>🏦 Garanție prin poliță (activă)</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: G.blue }}>{fmtRON(politaTotal)}</div>
                    <div style={{ fontSize: 11, color: G.dim, marginTop: 2 }}>{politeActive.length} poliță{politeActive.length === 1 ? '' : 'e'} activă{politeActive.length === 1 ? '' : 'e'}</div>
                  </div>
                  {retinut > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>✂️ Reținut din IPC (rămas)</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: ramas > 0 ? G.orange : G.green }}>{fmtRON(ramas)}</div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Reținut total</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>{fmtRON(retinut)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Restituit</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: G.green }}>{fmtRON(restituit)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Rămas de recuperat</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: ramas > 0 ? G.orange : G.green }}>{fmtRON(ramas)}</div>
                    </div>
                  </div>
                  {/* Bară restituit */}
                  <div style={{ height: 8, borderRadius: 5, background: G.border2, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{ width: `${pctRestit}%`, height: '100%', background: G.green, borderRadius: 5, transition: 'width .3s' }} />
                  </div>
                  <div style={{ fontSize: 11, color: G.muted }}>{pctRestit.toLocaleString('ro-RO', { maximumFractionDigits: 1 })}% restituit</div>

                  {/* Deblocări estimate */}
                  {ramas > 0.5 && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${G.border}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ padding: '8px 12px', background: G.surface, borderRadius: 8, border: `1px solid ${G.border}` }}>
                        <div style={{ fontSize: 11, color: G.muted }}>📋 Deblocare la recepție ({pctRec}%)</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: G.blue }}>{fmtRON(deblocRec)}</div>
                      </div>
                      <div style={{ padding: '8px 12px', background: G.surface, borderRadius: 8, border: `1px solid ${G.border}` }}>
                        <div style={{ fontSize: 11, color: G.muted }}>🏁 Deblocare final valabilitate ({pctFin}%)</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: G.purple }}>{fmtRON(deblocFin)}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
              {contract.gbe_data_estimata_recuperare && (
                <div style={{ marginTop: 12, fontSize: 12, color: G.muted }}>
                  🗓️ Termen estimat recuperare: <b style={{ color: G.text }}>{contract.gbe_data_estimata_recuperare}</b>
                  {zRecup != null && <span style={{ marginLeft: 6, color: zRecup < 0 ? G.red : (zRecup <= 60 ? G.yellow : G.muted) }}>({zRecup < 0 ? `depășit ${Math.abs(zRecup)}z` : `${zRecup}z rămase`})</span>}
                </div>
              )}
              {contract.gbe_observatii && (
                <div style={{ marginTop: 8, fontSize: 12, color: G.dim, fontStyle: 'italic' }}>📝 {contract.gbe_observatii}</div>
              )}
            </div>

            {/* ── POLIȚE ── */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.blue }}>🏦 Polițe / scrisori de garanție ({polite.length})</div>
                {canManage && mode !== 'polita' && (
                  <button onClick={() => { setEditItem(null); setMode('polita') }} style={{ padding: '6px 12px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Poliță</button>
                )}
              </div>
              {mode === 'polita' && (
                <PolitaFormGBE contract={contract} polita={editItem}
                  onCancel={() => { setMode(null); setEditItem(null) }}
                  onSaved={() => { setMode(null); setEditItem(null); loadData(); onChanged && onChanged() }} />
              )}
              {polite.length === 0 && mode !== 'polita' && (
                <div style={{ fontSize: 12, color: G.dim, padding: '8px 0' }}>Nicio poliță înregistrată.</div>
              )}
              {polite.map(p => {
                const z = zileRamase(p.data_expirare)
                const expColor = z == null ? G.muted : z < 0 ? G.red : z <= 30 ? G.red : z <= 60 ? G.yellow : G.green
                return (
                  <div key={p.id} style={{ padding: '10px 14px', marginBottom: 6, borderRadius: 8, background: G.bg, border: `1px solid ${G.border}`, opacity: p.activ ? 1 : 0.55, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>
                        {p.numar_polita || '(fără număr)'} {p.emitent ? <span style={{ color: G.muted, fontWeight: 500 }}>· {p.emitent}</span> : null}
                        {!p.activ && <span style={{ marginLeft: 8, fontSize: 10, color: G.muted }}>(inactivă)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
                        {p.data_emitere && `emisă ${p.data_emitere}`}
                        {p.data_expirare && <span style={{ color: expColor, fontWeight: 600 }}> · expiră {p.data_expirare}{z != null ? ` (${z < 0 ? `depășit ${Math.abs(z)}z` : `${z}z`})` : ''}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: G.blue, whiteSpace: 'nowrap' }}>{fmtRON(p.valoare_lei)}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {p.document_path && <button onClick={() => handleViewDoc(p.document_path)} title="Vezi document" style={{ padding: '4px 8px', background: G.text + '18', color: G.text, border: `1px solid ${G.border}`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>📎</button>}
                      {canManage && <button onClick={() => { setEditItem(p); setMode('polita') }} title="Editează" style={{ padding: '4px 8px', background: G.orange + '22', color: G.orange, border: `1px solid ${G.orange}44`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>✏️</button>}
                      {canManage && <button onClick={() => handleDeletePolita(p.id)} title="Șterge" style={{ padding: '4px 8px', background: G.red + '18', color: G.red, border: `1px solid ${G.red}44`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>🗑</button>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── RESTITUIRI ── */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.green }}>💸 Restituiri / deblocări ({restituiri.length})</div>
                {canManage && mode !== 'restituire' && (
                  <button onClick={() => { setEditItem(null); setMode('restituire') }} style={{ padding: '6px 12px', background: G.green + '22', color: G.green, border: `1px solid ${G.green}44`, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Înregistrează restituire</button>
                )}
              </div>
              {mode === 'restituire' && (
                <RestituireFormGBE contract={contract} restituire={editItem}
                  onCancel={() => { setMode(null); setEditItem(null) }}
                  onSaved={() => { setMode(null); setEditItem(null); loadData(); onChanged && onChanged() }} />
              )}
              {restituiri.length === 0 && mode !== 'restituire' && (
                <div style={{ fontSize: 12, color: G.dim, padding: '8px 0' }}>Nicio restituire înregistrată.</div>
              )}
              {restituiri.map(r => {
                const tipLabel = (GBE_RESTITUIRE_TIP.find(t => t.val === r.tip) || {}).label || r.tip
                return (
                  <div key={r.id} style={{ padding: '10px 14px', marginBottom: 6, borderRadius: 8, background: G.bg, border: `1px solid ${G.border}`, borderLeft: `3px solid ${G.green}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>{r.data_restituire} · {tipLabel}</div>
                      {r.observatii && <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>{r.observatii}</div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: G.green, whiteSpace: 'nowrap' }}>{fmtRON(r.valoare_lei)}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.document_path && <button onClick={() => handleViewDoc(r.document_path)} title="Vezi document" style={{ padding: '4px 8px', background: G.text + '18', color: G.text, border: `1px solid ${G.border}`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>📎</button>}
                      {canManage && <button onClick={() => { setEditItem(r); setMode('restituire') }} title="Editează" style={{ padding: '4px 8px', background: G.orange + '22', color: G.orange, border: `1px solid ${G.orange}44`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>✏️</button>}
                      {canManage && <button onClick={() => handleDeleteRestituire(r.id)} title="Șterge" style={{ padding: '4px 8px', background: G.red + '18', color: G.red, border: `1px solid ${G.red}44`, borderRadius: 5, cursor: 'pointer', fontSize: 11 }}>🗑</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ContracteComerciale({ profile }) {
  const [contracte, setContracte] = useState([])
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState([])
  const [beneficiari, setBeneficiari] = useState([])
  const [filterSens, setFilterSens] = useState('toate')  // toate | incasare | plata
  const [filterTip, setFilterTip] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortBy, setSortBy] = useState('recent')  // recent | nume | valoare_desc | valoare_asc | termen
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editContract, setEditContract] = useState(null)
  const [liniiContract, setLiniiContract] = useState(null)
  const [facturiContract, setFacturiContract] = useState(null)
  const [acteContract, setActeContract] = useState(null)
  const [gbeContract, setGbeContract] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [expanded, setExpanded] = useState({})  // { [contractMamaId]: true=deschis }; gol = toate închise

  const toggleCollapse = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const isOwner = profile?.is_owner === true
  const canManage = isOwner || profile?.can_manage_contracts === true

  useEffect(() => { loadAll() }, [])

  async function handleChangeStatus(c, nouStatus) {
    if (nouStatus === c.status) return
    const { error } = await supabase.from('contracte_terti').update({ status: nouStatus, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { alert('Eroare la schimbare status: ' + error.message); return }
    loadAll()
  }

  async function handleViewPdf(c) {
    if (!c?.pdf_path) return
    const { data, error } = await supabase.storage.from('contracte-terti').createSignedUrl(c.pdf_path, 120)
    if (error || !data?.signedUrl) { alert('Nu am putut deschide PDF-ul: ' + (error?.message || 'lipsă fișier')); return }
    window.open(data.signedUrl, '_blank')
  }


  async function loadAll() {
    setLoading(true)
    const [{ data: contracteData }, { data: sitesData }, { data: benData }, { data: pdfData }, { data: gbeRows }, { data: politeRows }] = await Promise.all([
      supabase.from('v_contracte_cu_linii').select('*').order('sens').order('created_at', { ascending: false }),
      supabase.from('sites').select('id, name, denumire_qr').order('name'),
      supabase.from('beneficiari').select('id, nume').eq('activ', true).order('nume'),
      supabase.from('contracte_terti').select('id, pdf_path, gbe_tip, gbe_pct_deblocare_receptie, gbe_pct_deblocare_final, garantie_perioada_luni, gbe_data_estimata_recuperare, gbe_observatii'),
      supabase.from('v_gbe_per_contract').select('contract_id, gbe_retinut, gbe_restituit, gbe_ramas'),
      supabase.from('gbe_polite').select('contract_id, data_expirare, valoare_lei').eq('activ', true),
    ])
    // v_contracte_cu_linii nu expune pdf_path / câmpuri GBE → le alipim din tabela de bază + view GBE
    const baseMap  = new Map((pdfData || []).map(r => [r.id, r]))
    const gbeMap   = new Map((gbeRows || []).map(r => [r.contract_id, r]))
    const politeMap = new Map()
    ;(politeRows || []).forEach(p => {
      const arr = politeMap.get(p.contract_id) || []
      arr.push(p); politeMap.set(p.contract_id, arr)
    })
    setContracte((contracteData || []).map(c => {
      const base = baseMap.get(c.id) || {}
      const pol = politeMap.get(c.id) || []
      // cea mai apropiată expirare de poliță activă (zile)
      const polZile = pol.map(p => zileRamase(p.data_expirare)).filter(z => z != null)
      return {
        ...c,
        pdf_path: base.pdf_path || null,
        gbe_tip: base.gbe_tip || null,
        gbe_pct_deblocare_receptie: base.gbe_pct_deblocare_receptie,
        gbe_pct_deblocare_final: base.gbe_pct_deblocare_final,
        garantie_perioada_luni: base.garantie_perioada_luni,
        gbe_data_estimata_recuperare: base.gbe_data_estimata_recuperare || null,
        gbe_observatii: base.gbe_observatii || null,
        _gbe: gbeMap.get(c.id) || null,
        _politaExpZile: polZile.length ? Math.min(...polZile) : null,
        _nrPolite: pol.length,
      }
    }))
    setSites(sitesData || [])
    setBeneficiari(benData || [])
    setLoading(false)
  }

  // Filtrare
  const filtered = useMemo(() => {
    return (contracte || []).filter(c => {
      if (filterSens !== 'toate' && c.sens !== filterSens) return false
      if (filterTip && c.tip_contract !== filterTip) return false
      if (filterStatus && c.status !== filterStatus) return false
      if (search) {
        const q = search.toLowerCase()
        return (c.denumire || '').toLowerCase().includes(q)
          || (c.numar_contract || '').toLowerCase().includes(q)
          || (c.partener_text || '').toLowerCase().includes(q)
          || (c.beneficiar_name || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [contracte, filterSens, filterTip, filterStatus, search])

  // Sortare (12.06.2026) — la valoare folosim valoarea ACTUALĂ (cu acte adiționale) dacă există
  const sorted = useMemo(() => {
    if (sortBy === 'recent') return filtered
    const val = c => Number(c.valoare_cu_acte ?? c.valoare_lei ?? 0)
    const list = [...filtered]
    if (sortBy === 'nume') list.sort((a,b) => (a.denumire||'').localeCompare(b.denumire||'', 'ro', { sensitivity:'base' }))
    else if (sortBy === 'valoare_desc') list.sort((a,b) => val(b) - val(a))
    else if (sortBy === 'valoare_asc') list.sort((a,b) => val(a) - val(b))
    else if (sortBy === 'termen') list.sort((a,b) => (a.data_termen||'9999-12-31').localeCompare(b.data_termen||'9999-12-31'))
    return list
  }, [filtered, sortBy])

  const upstream   = sorted.filter(c => c.sens === 'incasare')
  const downstream = sorted.filter(c => c.sens === 'plata')
  const contracteUpstream = contracte.filter(c => c.sens === 'incasare')

  // KPIs
  const totalUpstream   = contracte.filter(c => c.sens === 'incasare').reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
  const totalDownstream = contracte.filter(c => c.sens === 'plata').reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
  const nrDepasit       = contracte.reduce((s, c) => s + Number(c.nr_pret_depasit_neaprobat || 0), 0)

  return (
    <div>
      {/* Dashboard alerte */}
      {!loading && contracte.length > 0 && (
        <AlerteDashboard
          contracte={contracte}
          onFilterSens={s => setFilterSens(s)}
          onFilterStatus={s => setFilterStatus(s)}
          onOpenGbe={c => setGbeContract(c)}
        />
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { icon: '🔼', label: 'Contracte upstream', value: contracte.filter(c => c.sens === 'incasare').length, color: G.blue },
          { icon: '💰', label: 'Valoare upstream', value: fmtRON(totalUpstream), color: G.green },
          { icon: '🔽', label: 'Contracte prestatori', value: contracte.filter(c => c.sens === 'plata').length, color: G.purple },
          { icon: nrDepasit > 0 ? '⚠️' : '✅', label: 'Prețuri depășite neaprobate', value: nrDepasit || '0', color: nrDepasit > 0 ? G.red : G.green },
        ].map(k => (
          <div key={k.label} style={{
            ...S.card, padding: '14px 18px',
            borderColor: k.color + '44', borderTopWidth: 3,
          }}>
            <div style={{ fontSize: 11, color: k.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {k.icon} {k.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: G.text }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filtre + buton nou */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Caută contract / partener..."
          style={{ ...S.input, width: 220 }} />

        <div style={{ display: 'flex', gap: 4, background: G.surface, borderRadius: 8, padding: 4, border: `1px solid ${G.border}` }}>
          {[
            { val: 'toate', label: 'Toate' },
            { val: 'incasare', label: '🔼 Upstream' },
            { val: 'plata', label: '🔽 Downstream' },
          ].map(f => (
            <button key={f.val} onClick={() => setFilterSens(f.val)} style={{
              padding: '6px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: filterSens === f.val ? G.orange + '33' : 'transparent',
              color: filterSens === f.val ? G.orange : G.muted,
              fontWeight: 700, fontSize: 12,
            }}>{f.label}</button>
          ))}
        </div>

        <select value={filterTip} onChange={e => setFilterTip(e.target.value)} style={{ ...S.select, width: 180 }}>
          <option value="">Toate tipurile</option>
          {Object.entries(TIP_META).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...S.select, width: 140 }}>
          <option value="">Toate statusurile</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...S.select, width: 160 }} title="Sortare listă">
          <option value="recent">🕐 Recente</option>
          <option value="nume">🔤 Nume A→Z</option>
          <option value="valoare_desc">💰 Valoare ↓</option>
          <option value="valoare_asc">💰 Valoare ↑</option>
          <option value="termen">⏳ Termen apropiat</option>
        </select>

        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={() => setImportOpen(true)} style={{ ...S.btnP, background: G.green }}>
              📥 Import facturi furnizor (Cont 401)
            </button>
            <button onClick={() => { setEditContract(null); setModalOpen(true) }} style={{ ...S.btnP }}>
              + Contract nou
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: G.muted }}>⏳ Se încarcă contractele...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📜</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: G.text, marginBottom: 6 }}>Niciun contract</div>
          <div style={{ fontSize: 13, color: G.muted }}>
            {search || filterTip || filterStatus || filterSens !== 'toate'
              ? 'Niciun contract nu corespunde filtrelor selectate.'
              : 'Adaugă primul contract comercial.'}
          </div>
        </div>
      ) : (
        <>
          {/* UPSTREAM */}
          {(filterSens === 'toate' || filterSens === 'incasare') && upstream.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.blue, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  🔼 Upstream — Gazpet Execută
                </div>
                <div style={{ fontSize: 11, color: G.muted }}>({upstream.length} contracte · {fmtRON(upstream.reduce((s, c) => s + Number(c.valoare_lei || 0), 0))})</div>

              </div>
              {upstream.map(c => {
                const childDs = contracte.filter(d => d.sens === 'plata' && String(d.contract_parinte_id) === String(c.id))
                return (
                  <React.Fragment key={c.id}>
                    <ContractCard c={c} isOwner={isOwner} canManage={canManage}
                      isMama={childDs.length > 0}
                      nrCopii={childDs.length}
                      totalCopii={childDs.reduce((s, d) => s + Number(d.valoare_lei || 0), 0)}
                      totalFacturatCopii={childDs.reduce((s, d) => s + Number(d.total_facturat_net ?? d.total_facturat ?? 0), 0)}
                      collapsed={!expanded[c.id]}
                      onToggleCollapse={toggleCollapse}
                      onEdit={c => { setEditContract(c); setModalOpen(true) }}
                      onViewLinii={c => setLiniiContract(c)}
                      onViewFacturi={c => setFacturiContract(c)}
                      onViewActe={c => setActeContract(c)}
                      onViewGBE={c => setGbeContract(c)}
                      onViewPdf={handleViewPdf}
                      onChangeStatus={handleChangeStatus} />
                    {childDs.length > 0 && expanded[c.id] && (
                      <div style={{ marginLeft: 24, marginBottom: 8 }}>
                        {childDs.map(d => {
                          const dSt = STATUS_META[d.status] || STATUS_META.draft
                          const dTip = TIP_META[d.tip_contract]
                          return (
                            <div key={d.id} style={{
                              padding: '10px 14px', marginBottom: 4, borderRadius: 8,
                              background: G.surface, border: `1px solid ${G.purple}44`,
                              borderLeft: `3px solid ${G.purple}`, display: 'flex', alignItems: 'center', gap: 12,
                            }}>
                              <span style={{ fontSize: 16, opacity: 0.6 }}>↳</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: G.text, fontFamily: 'monospace' }}>Nr. {d.numar_contract || '—'}</span>
                                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: dSt.color + '22', color: dSt.color, fontWeight: 700 }}>{dSt.label}</span>
                                  {dTip && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: dTip.color + '22', color: dTip.color }}>{dTip.emoji} {dTip.label}</span>}
                                </div>
                                <div style={{ fontSize: 12, color: G.text, wordBreak: 'break-word' }}>{d.denumire}</div>
                                <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>{d.partener_text || d.beneficiar_name}{d.site_qr && ` · 📍 ${d.site_qr}`}</div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: G.purple }}>↑ {fmtRON(d.valoare_lei)}</div>
                                {Number(d.valoare_eur || 0) > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: G.muted }}>💶 {fmtEUR(d.valoare_eur)}</div>}
                                <ProgresBar procent={d.procent_realizat} compact />
                                {(Number(d.total_facturat) > 0 || Number(d.total_platit) > 0) && (
                                  <div style={{ fontSize: 10.5, textAlign: 'right', lineHeight: 1.5 }} title="Facturat/Plătit = cu TVA (cont 401). Rămas de facturat = NET, comparabil cu valoarea contractului (fără TVA).">
                                    <div style={{ color: G.green, fontWeight: 700 }}>📄 Facturat {fmtRON(d.total_facturat)}</div>
                                    <div style={{ color: G.blue, fontWeight: 700 }}>💸 Plătit {fmtRON(d.total_platit)}</div>
                                    {Number(d.total_facturat || 0) - Number(d.total_platit || 0) > 0.005 && (
                                      <div style={{ color: G.orange, fontWeight: 700 }}>⏳ Rest de plată {fmtRON(Number(d.total_facturat || 0) - Number(d.total_platit || 0))}</div>
                                    )}
                                    <div style={{ color: G.muted }}>Rămas de facturat {fmtRON(Number(d.valoare_lei || 0) - Number(d.total_facturat_net ?? d.total_facturat ?? 0))} <span style={{ color: G.dim }}>net</span></div>
                                  </div>
                                )}
                                {canManage && (
                                  <select value={d.status} onChange={e => handleChangeStatus(d, e.target.value)}
                                    title="Schimbă status"
                                    style={{ padding: '2px 5px', fontSize: 10, fontWeight: 700, borderRadius: 4, background: dSt.color + '22', color: dSt.color, border: `1px solid ${dSt.color}44`, cursor: 'pointer', outline: 'none', colorScheme: 'dark' }}>
                                    <option value="activ" style={{ background: G.surface, color: G.text }}>Activ</option>
                                    <option value="suspendat" style={{ background: G.surface, color: G.text }}>Suspendat</option>
                                    <option value="finalizat" style={{ background: G.surface, color: G.text }}>Închis</option>
                                    <option value="draft" style={{ background: G.surface, color: G.text }}>Draft</option>
                                    <option value="reziliat" style={{ background: G.surface, color: G.text }}>Reziliat</option>
                                  </select>
                                )}
                                <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  <button onClick={() => setFacturiContract(d)} style={{ padding: '3px 8px', background: G.green + '22', color: G.green, border: `1px solid ${G.green}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📄 Facturi ({d.nr_facturi_subc || 0})</button>
                                  <button onClick={() => setLiniiContract(d)} style={{ padding: '3px 8px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📋 Linii</button>
                                  <button onClick={() => setActeContract(d)} style={{ padding: '3px 8px', background: G.purple + '22', color: G.purple, border: `1px solid ${G.purple}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>⚡ Acte ({d.nr_acte_aditionale || 0})</button>
                                  {(Number(d.garantie_buna_executie_pct) > 0 || d.gbe_tip || d._gbe || d._nrPolite > 0) && (
                                    <button onClick={() => setGbeContract(d)} style={{ padding: '3px 8px', background: G.yellow + '22', color: G.yellow, border: `1px solid ${G.yellow}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>🔐 GBE</button>
                                  )}
                                  {d.pdf_path && <button onClick={() => handleViewPdf(d)} style={{ padding: '3px 8px', background: G.text + '18', color: G.text, border: `1px solid ${G.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📎 PDF</button>}
                                  {isOwner && <button onClick={() => { setEditContract(d); setModalOpen(true) }} style={{ padding: '3px 8px', background: G.orange + '22', color: G.orange, border: `1px solid ${G.orange}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>✏️</button>}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          )}

          {/* DOWNSTREAM */}
          {(filterSens === 'toate' || filterSens === 'plata') && downstream.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: G.purple, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  🔽 Downstream — Contracte cu Prestatori
                </div>
                <div style={{ fontSize: 11, color: G.muted }}>({downstream.length} contracte · {fmtRON(downstream.reduce((s, c) => s + Number(c.valoare_lei || 0), 0))})</div>
              </div>
              {downstream.map(c => (
                <ContractCard key={c.id} c={c} isOwner={isOwner} canManage={canManage}
                  onEdit={c => { setEditContract(c); setModalOpen(true) }}
                  onViewLinii={c => setLiniiContract(c)}
                  onViewFacturi={c => setFacturiContract(c)}
                  onViewActe={c => setActeContract(c)}
                  onViewGBE={c => setGbeContract(c)}
                  onViewPdf={handleViewPdf}
                  onChangeStatus={handleChangeStatus} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal contract nou/editare */}
      {modalOpen && (
        <ModalContract
          contract={editContract}
          contracteUpstream={contracteUpstream}
          sites={sites}
          beneficiari={beneficiari}
          profile={profile}
          onClose={() => { setModalOpen(false); setEditContract(null) }}
          onSaved={() => { setModalOpen(false); setEditContract(null); loadAll() }}
        />
      )}

      {/* Modal linii */}
      {liniiContract && (
        <ModalLinii
          contract={liniiContract}
          profile={profile}
          onClose={() => setLiniiContract(null)}
        />
      )}

      {/* Modal facturi subcontractor (vizualizare per contract) */}
      {facturiContract && (
        <FacturiModal
          contract={facturiContract}
          profile={profile}
          onClose={() => setFacturiContract(null)}
          onChanged={loadAll}
        />
      )}

      {/* Modal acte adiționale */}
      {acteContract && (
        <ModalActeAditionale
          contract={acteContract}
          profile={profile}
          canManage={canManage}
          onClose={() => setActeContract(null)}
          onChanged={loadAll}
        />
      )}

      {/* Modal evidență GBE */}
      {gbeContract && (
        <ModalGBE
          contract={gbeContract}
          profile={profile}
          canManage={canManage}
          onClose={() => setGbeContract(null)}
          onChanged={loadAll}
        />
      )}

      {/* Modal import facturi WinMentor (global) */}
      {importOpen && (
        <ImportFacturiModal
          contracte={contracte}
          profile={profile}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); loadAll() }}
        />
      )}
    </div>
  )
}
