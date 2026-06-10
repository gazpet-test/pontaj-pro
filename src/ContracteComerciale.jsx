// ===========================================================================
// CONTRACTE COMERCIALE — Tab Administrativ
// 07.06.2026 v1 — Lista upstream/downstream + modal adăugare
// Fundație BD: contracte_terti extins + contracte_linii + v_contracte_cu_linii
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
  input: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  label: { fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, display: 'block' },
  select: { width: '100%', padding: '9px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: 'pointer' },
}

// ─── Meta date tipuri + roluri ─────────────────────────────────────────────
const TIP_META = {
  asociere:         { label: 'Asociere',         emoji: '🤝', color: G.blue },
  subcontractare:   { label: 'Subcontractare',   emoji: '📋', color: G.yellow },
  prestari_servicii:{ label: 'Prestări Servicii',emoji: '🔧', color: G.purple },
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
// Întoarce DOAR facturile (credit, tip ≠ plată). Plățile (OP/debit) le ignoră.
function parseNum(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
function parseFisaWinMentor(rows) {
  const facturi = []
  const reCtr = /(?:ctr|contract|anexa)\.?\s*(?:nr\.?)?\s*(\d{2,5})/i
  const reData = /^(\d{2})\.(\d{2})\.(\d{4})$/
  for (const r of (rows || [])) {
    if (!Array.isArray(r)) continue
    const colA = (r[0] ?? '').toString().trim().toLowerCase()
    if (colA.startsWith('total') || colA.replace(/\s/g, '').startsWith('total')) continue
    const dataRaw = (r[1] ?? '').toString().trim()
    const md = dataRaw.match(reData)
    if (!md) continue
    const tip = (r[2] ?? '').toString().trim()
    const numar = (r[3] ?? '').toString().trim()
    const credit = parseNum(r[10])
    const debit = parseNum(r[9])
    const valoareE = parseNum(r[4])
    const obs = (r[14] ?? '').toString().trim()
    const tipUp = tip.toUpperCase()
    const ePlata = /^(OP|CH|CHIT|PLAT|ORDIN|EXTRAS)/.test(tipUp) || (debit > 0 && credit === 0)
    if (ePlata) continue
    const val = credit > 0 ? credit : valoareE
    if (!(val > 0)) continue
    const dataISO = `${md[3]}-${md[2]}-${md[1]}`
    let refNr = null, refText = null
    const mc = obs.match(reCtr)
    if (mc) { refNr = mc[1]; refText = obs.slice(0, 80) }
    facturi.push({ tip_document: tip, numar_document: numar, data_document: dataISO, valoare_lei: val, observatii: obs, ref_nr: refNr, ref_text: refText })
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

  const total = facturi.reduce((s, f) => s + Number(f.valoare_lei || 0), 0)
  const valContract = Number(contract.valoare_lei || 0)
  const procent = valContract > 0 ? (total / valContract) * 100 : null
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

        {/* Sumar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Contractat', val: fmtRON(valContract), color: G.text },
            { label: 'Facturat', val: fmtRON(total), color: G.green, sub: `${facturi.length} facturi` },
            { label: depasire ? '⚠️ Depășire' : 'Rămas', val: fmtRON(Math.abs(valContract - total)), color: depasire ? G.red : G.text },
          ].map(k => (
            <div key={k.label} style={{ ...S.card, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{k.val}</div>
              {k.sub && <div style={{ fontSize: 10, color: G.dim, marginTop: 2 }}>{k.sub}</div>}
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
                  <td style={{ padding: '7px 4px' }}>{f.tip_document} {f.numar_document}</td>
                  <td style={{ padding: '7px 4px', color: G.muted }}>{f.data_document}</td>
                  <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtRON(f.valoare_lei)}</td>
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
  const [parsed, setParsed] = useState([])   // facturi parsate + matching
  const [saving, setSaving] = useState(false)
  const [rezultat, setRezultat] = useState(null)

  // contracte candidate pentru alocare (numar → contract)
  const optiuniContracte = useMemo(
    () => (contracte || []).filter(c => c.numar_contract).map(c => ({
      id: c.id, numar: c.numar_contract,
      label: `Nr. ${c.numar_contract} · ${(c.partener_text || c.beneficiar_name || c.denumire || '').slice(0, 40)}`,
    })),
    [contracte]
  )

  async function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    const facturi = parseFisaWinMentor(rows)
    // matching pe numar_contract
    const enriched = facturi.map((f, i) => {
      let contractId = null
      if (f.ref_nr) {
        const hit = optiuniContracte.find(o => String(o.numar) === String(f.ref_nr))
        if (hit) contractId = hit.id
      }
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

  const cuRef = parsed.filter(f => f.contract_id)
  const faraRef = parsed.filter(f => !f.contract_id)
  const sumaTotal = parsed.reduce((s, f) => s + Number(f.valoare_lei || 0), 0)

  async function salveaza() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    // 1. audit import
    const { data: imp } = await supabase.from('contracte_subcontract_import').insert({
      fisier_nume: fileName, furnizor_text: furnizor || null,
      total_randuri: parsed.length, facturi_total: parsed.length,
      facturi_alocate: cuRef.length, facturi_nealocate: faraRef.length,
      suma_facturi_lei: sumaTotal, imported_by: user?.id || null,
    }).select().single()

    // 2. facturi (upsert pe cheia unică ca să nu dubleze la re-import)
    const rows = parsed.map(f => ({
      contract_id: f.contract_id, furnizor_text: furnizor || null,
      tip_document: f.tip_document, numar_document: f.numar_document,
      data_document: f.data_document, valoare_lei: f.valoare_lei,
      observatii_winmentor: f.observatii, referinta_detectata: f.ref_text,
      alocat: f.alocat, sursa: 'winmentor_xls', import_id: imp?.id || null,
      created_by: user?.id || null,
    }))
    const { error, count } = await supabase.from('contracte_subcontract_facturi')
      .upsert(rows, { onConflict: 'furnizor_text,tip_document,numar_document', count: 'exact' })
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
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>Fișa contului 401 — facturile primite de la subcontractor. Plățile (OP) sunt ignorate.</div>
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
                { label: 'Facturi găsite', val: parsed.length, color: G.blue },
                { label: 'Matchate automat', val: cuRef.length, color: G.green },
                { label: 'De confirmat', val: faraRef.length, color: faraRef.length > 0 ? G.yellow : G.muted },
                { label: 'Sumă totală', val: fmtRON(sumaTotal), color: G.text },
              ].map(k => (
                <div key={k.label} style={{ ...S.card, padding: '8px 14px', flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{k.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: k.color }}>{k.val}</div>
                </div>
              ))}
            </div>

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
                        <td style={{ padding: '7px 6px', whiteSpace: 'nowrap' }}>{f.tip_document} {f.numar_document}</td>
                        <td style={{ padding: '7px 6px', color: G.muted, whiteSpace: 'nowrap' }}>{f.data_document}</td>
                        <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtRON(f.valoare_lei)}</td>
                        <td style={{ padding: '7px 6px', color: G.dim, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.observatii}>
                          {f.observatii || <span style={{ color: G.yellow }}>(fără observație)</span>}
                        </td>
                        <td style={{ padding: '7px 6px' }}>
                          <select value={f.contract_id || ''} onChange={e => setContractFor(f._idx, e.target.value)}
                            style={{ ...S.select, width: 200, padding: '5px 8px', fontSize: 11, background: f.contract_id ? G.bg : G.yellow + '22' }}>
                            <option value="">⚠️ Nealocată</option>
                            {optiuniContracte.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
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
function ContractCard({ c, isOwner, canManage, onEdit, onViewLinii, onViewFacturi, onChangeStatus, isMama, nrCopii, totalCopii, collapsed, onToggleCollapse }) {
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
              <Badge
                label={collapsed
                  ? `🔗 ${nrCopii} ${nrCopii === 1 ? 'subcontract' : 'subcontracte'} · ${fmtRON(totalCopii)} (ascunse)`
                  : `🔗 ${nrCopii} ${nrCopii === 1 ? 'subcontract' : 'subcontracte'}`}
                color={G.blue} />
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
            {c.site_qr && <span>📍 {c.site_qr}</span>}
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
          {c.nr_acte_aditionale > 0 && (
            <div style={{ fontSize: 11, color: G.muted }}>
              +{c.nr_acte_aditionale} acte adiționale
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
                cursor: 'pointer', outline: 'none',
              }}>
              <option value="activ">Activ</option>
              <option value="suspendat">Suspendat</option>
              <option value="finalizat">Închis</option>
              <option value="draft">Draft</option>
              <option value="reziliat">Reziliat</option>
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
            {(isOwner) && (
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
        site_id: form.site_id ? Number(form.site_id) : null,
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
              // Downstream: asocierea nu se aplică (Gazpet e mereu constructor general față de prestator)
              .filter(([key]) => form.sens === 'incasare' || key !== 'asociere')
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
              setForm(f => ({
                ...f,
                contract_parinte_id: pid,
                site_id: parinte?.site_id ? String(parinte.site_id) : f.site_id,
              }))
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
            <label style={S.label}>Șantier / Proiect</label>
            <select value={form.site_id} onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))} style={S.select}>
              <option value="">— Fără șantier specific —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.denumire_qr || s.name}</option>)}
            </select>
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
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editContract, setEditContract] = useState(null)
  const [liniiContract, setLiniiContract] = useState(null)
  const [facturiContract, setFacturiContract] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [collapsed, setCollapsed] = useState({})  // { [contractMamaId]: true=ascuns }

  const toggleCollapse = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

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

  const upstream   = filtered.filter(c => c.sens === 'incasare')
  const downstream = filtered.filter(c => c.sens === 'plata')
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
                      collapsed={!!collapsed[c.id]}
                      onToggleCollapse={toggleCollapse}
                      onEdit={c => { setEditContract(c); setModalOpen(true) }}
                      onViewLinii={c => setLiniiContract(c)}
                      onViewFacturi={c => setFacturiContract(c)}
                      onChangeStatus={handleChangeStatus} />
                    {childDs.length > 0 && !collapsed[c.id] && (
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
                                {canManage && (
                                  <select value={d.status} onChange={e => handleChangeStatus(d, e.target.value)}
                                    title="Schimbă status"
                                    style={{ padding: '2px 5px', fontSize: 10, fontWeight: 700, borderRadius: 4, background: dSt.color + '22', color: dSt.color, border: `1px solid ${dSt.color}44`, cursor: 'pointer', outline: 'none' }}>
                                    <option value="activ">Activ</option>
                                    <option value="suspendat">Suspendat</option>
                                    <option value="finalizat">Închis</option>
                                    <option value="draft">Draft</option>
                                    <option value="reziliat">Reziliat</option>
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
