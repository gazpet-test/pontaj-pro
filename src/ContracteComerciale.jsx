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
function ContractCard({ c, isOwner, canManage, onEdit, onViewLinii, onViewFacturi, onChangeStatus, isMama, nrCopii, totalCopii, totalFacturatCopii, collapsed, onToggleCollapse }) {
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
          {c.valoare_cu_acte != null && Number(c.valoare_cu_acte) !== Number(c.valoare_lei || 0) && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: G.purple }} title="Valoarea actuală cu actele adiționale aplicate (din ambele module)">
              ⚡ cu acte: {fmtRON(c.valoare_cu_acte)}
            </div>
          )}
          {c.nr_acte_aditionale > 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: G.purple }}>
              +{c.nr_acte_aditionale} acte adiționale
            </div>
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

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 2 }}>
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
    data_semnare: contract?.data_semnare || '',
    data_termen: contract?.data_termen || '',
    termen_plata_zile: contract?.termen_plata_zile || '',
    garantie_buna_executie_pct: contract?.garantie_buna_executie_pct || '',
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
        data_semnare: form.data_semnare || null,
        data_termen: form.data_termen || null,
        termen_plata_zile: form.termen_plata_zile ? Number(form.termen_plata_zile) : null,
        garantie_buna_executie_pct: form.garantie_buna_executie_pct ? Number(form.garantie_buna_executie_pct) : null,
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={S.label}>Valoare Contract (RON)</label>
            <input type="number" value={form.valoare_lei} onChange={e => setForm(f => ({ ...f, valoare_lei: e.target.value }))}
              placeholder="0" style={S.input} />
          </div>
          <div>
            <label style={S.label}>Termen Plată (zile)</label>
            <input type="number" value={form.termen_plata_zile} onChange={e => setForm(f => ({ ...f, termen_plata_zile: e.target.value }))}
              placeholder="30" style={S.input} />
          </div>
          <div>
            <label style={S.label}>GBE % din Valoare</label>
            <input type="number" value={form.garantie_buna_executie_pct} onChange={e => setForm(f => ({ ...f, garantie_buna_executie_pct: e.target.value }))}
              placeholder="10" style={S.input} />
          </div>
        </div>

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
function AlerteDashboard({ contracte, onFilterSens, onFilterStatus }) {
  const azi = new Date()
  const in30z = new Date(Date.now() + 30 * 24 * 3600 * 1000)

  const faraParinte  = contracte.filter(c => c.sens === 'plata' && !c.contract_parinte_id)
  const expirate     = contracte.filter(c => c.data_termen && new Date(c.data_termen) < azi && c.status === 'activ')
  const expiraCurand = contracte.filter(c => c.data_termen && new Date(c.data_termen) >= azi && new Date(c.data_termen) <= in30z && c.status === 'activ')
  const inDraft      = contracte.filter(c => c.status === 'draft')

  const alerte = [
    expirate.length     && { icon: '❌', label: `${expirate.length} contract${expirate.length > 1 ? 'e' : ''} expirat${expirate.length > 1 ? 'e' : ''}`, color: G.red,    action: () => onFilterStatus('activ') },
    expiraCurand.length && { icon: '⏳', label: `${expiraCurand.length} expiră în 30 zile`, color: G.yellow, action: () => onFilterStatus('activ') },
    faraParinte.length  && { icon: '🔗', label: `${faraParinte.length} fără contract mamă`, color: G.orange, action: () => onFilterSens('plata') },
    inDraft.length      && { icon: '📋', label: `${inDraft.length} draft${inDraft.length > 1 ? '-uri' : ''} nesemnate`, color: G.muted, action: () => onFilterStatus('draft') },
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


  async function loadAll() {
    setLoading(true)
    const [{ data: contracteData }, { data: sitesData }, { data: benData }] = await Promise.all([
      supabase.from('v_contracte_cu_linii').select('*').order('sens').order('created_at', { ascending: false }),
      supabase.from('sites').select('id, name, denumire_qr').order('name'),
      supabase.from('beneficiari').select('id, nume').eq('activ', true).order('nume'),
    ])
    setContracte(contracteData || [])
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
                                <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                  <button onClick={() => setFacturiContract(d)} style={{ padding: '3px 8px', background: G.green + '22', color: G.green, border: `1px solid ${G.green}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📄 Facturi ({d.nr_facturi_subc || 0})</button>
                                  <button onClick={() => setLiniiContract(d)} style={{ padding: '3px 8px', background: G.blue + '22', color: G.blue, border: `1px solid ${G.blue}44`, borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>📋 Linii</button>
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
