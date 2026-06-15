// ===========================================================================
// DASHBOARD SUBCONTRACTORI ↔ CONTRACTE — Tab Administrativ
// 15.06.2026 v1 — Consolidare upstream (contracte mamă) vs downstream (subcontracte)
//   Comutare: 🔗 Pe contract mamă (waterfall) ↔ 🏢 Pe subcontractor (rollup firmă)
//   Sursă: v_contracte_cu_linii. Alerte: subcontracte fără mamă + over-allocation.
//   Net (fără TVA) pt facturat vs valoare contract; cu TVA pt plătit/rest de plată.
// ===========================================================================

import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  orange:'#F0883E', purple:'#A371F7', blue:'#1F6FEB', green:'#2EA043',
  yellow:'#D29922', red:'#F85149',
}
const S = {
  card: { background: G.card, borderRadius: 12, border: `1px solid ${G.border}` },
}

function fmtRON(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' lei'
}
function fmtEUR(v) {
  const n = Number(v || 0)
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}

function Bar({ pct, color }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0))
  return (
    <div style={{ width: 120, height: 6, background: G.bg, borderRadius: 3, overflow: 'hidden', border: `1px solid ${G.border}` }}>
      <div style={{ width: `${p}%`, height: '100%', background: color || G.green, transition: 'width 0.3s' }} />
    </div>
  )
}

function KPI({ icon, label, value, sub, color }) {
  return (
    <div style={{ ...S.card, padding: '14px 18px', borderColor: color + '44', borderTopWidth: 3 }}>
      <div style={{ fontSize: 11, color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, color: G.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// Metrici comune pentru un set de subcontracte (copii)
function calcMetrics(copii) {
  const contractat   = copii.reduce((s, d) => s + Number(d.valoare_lei || 0), 0)
  const facturatNet  = copii.reduce((s, d) => s + Number(d.total_facturat_net ?? d.total_facturat ?? 0), 0)
  const facturatTva  = copii.reduce((s, d) => s + Number(d.total_facturat || 0), 0)
  const platit       = copii.reduce((s, d) => s + Number(d.total_platit || 0), 0)
  return {
    contractat, facturatNet, facturatTva, platit,
    restFacturat: contractat - facturatNet,
    restPlata: facturatTva - platit,
  }
}

// Mini-tabel cu subcontractele unei grupări (mamă sau firmă)
function CopiiTable({ copii, showFirma }) {
  return (
    <div style={{ marginTop: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead>
          <tr style={{ color: G.muted, textAlign: 'left' }}>
            <th style={{ padding: '5px 8px', fontWeight: 700 }}>Nr.</th>
            <th style={{ padding: '5px 8px', fontWeight: 700 }}>{showFirma ? 'Subcontractor' : 'Denumire'}</th>
            <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'right' }}>Contractat</th>
            <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'right' }}>Facturat (net)</th>
            <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'right' }}>Plătit</th>
            <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'right' }}>Rest plată</th>
          </tr>
        </thead>
        <tbody>
          {copii.map(d => {
            const facturatTva = Number(d.total_facturat || 0)
            const platit = Number(d.total_platit || 0)
            const restPlata = facturatTva - platit
            const eEur = Number(d.valoare_eur || 0) > 0
            return (
              <tr key={d.id} style={{ borderTop: `1px solid ${G.border2}` }}>
                <td style={{ padding: '5px 8px', color: G.text, fontFamily: 'monospace' }}>{d.numar_contract || '—'}</td>
                <td style={{ padding: '5px 8px', color: G.text, maxWidth: 260, wordBreak: 'break-word' }}>
                  {showFirma ? (d.partener_text || d.beneficiar_name || '—') : (d.denumire || '—')}
                  {d.site_qr && <span style={{ color: G.dim }}> · 📍 {d.site_qr}</span>}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: G.purple, fontWeight: 700 }}>
                  {fmtRON(d.valoare_lei)}{eEur && <div style={{ color: G.dim, fontWeight: 600 }}>{fmtEUR(d.valoare_eur)}</div>}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: G.green }}>{fmtRON(d.total_facturat_net ?? d.total_facturat ?? 0)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: G.blue }}>{fmtRON(platit)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: restPlata > 0.5 ? G.orange : G.green, fontWeight: 700 }}>
                  {Math.abs(restPlata) < 0.5 ? '0 lei' : fmtRON(restPlata)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function DashboardSubcontractori({ profile }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('mama')        // 'mama' | 'subc'
  const [expanded, setExpanded] = useState({})     // { [key]: true }
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('v_contracte_cu_linii').select('*').order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  const toggle = (key) => setExpanded(p => ({ ...p, [key]: !p[key] }))

  const upstream   = useMemo(() => rows.filter(r => r.sens === 'incasare'), [rows])
  const downstream = useMemo(() => rows.filter(r => r.sens === 'plata'), [rows])

  // ── Grupare pe contract mamă ──────────────────────────────────────────────
  const mame = useMemo(() => upstream.map(m => {
    const copii = downstream.filter(d => String(d.contract_parinte_id) === String(m.id))
    const met = calcMetrics(copii)
    const valMama = Number(m.valoare_cu_acte ?? m.valoare_lei ?? 0)
    return {
      ...m, copii, ...met, valMama,
      ramasGazpet: valMama - met.contractat,
      overAlloc: met.contractat > valMama + 0.5,
    }
  }).filter(m => m.copii.length > 0), [upstream, downstream])

  const mameFiltrate = useMemo(() => {
    if (!search) return mame
    const q = search.toLowerCase()
    return mame.filter(m => (m.denumire || '').toLowerCase().includes(q)
      || (m.numar_contract || '').toLowerCase().includes(q)
      || m.copii.some(d => (d.partener_text || d.beneficiar_name || '').toLowerCase().includes(q)))
  }, [mame, search])

  // ── Rollup pe subcontractor (firmă) ───────────────────────────────────────
  const subcontractori = useMemo(() => {
    const map = new Map()
    downstream.forEach(d => {
      const key = (d.partener_text || d.beneficiar_name || '— necunoscut —').trim()
      if (!map.has(key)) map.set(key, { firma: key, copii: [] })
      map.get(key).copii.push(d)
    })
    return [...map.values()]
      .map(e => ({ ...e, nr: e.copii.length, ...calcMetrics(e.copii) }))
      .sort((a, b) => b.contractat - a.contractat)
  }, [downstream])

  const subcFiltrati = useMemo(() => {
    if (!search) return subcontractori
    const q = search.toLowerCase()
    return subcontractori.filter(s => s.firma.toLowerCase().includes(q))
  }, [subcontractori, search])

  // ── Alerte ────────────────────────────────────────────────────────────────
  const orfane = useMemo(() => downstream.filter(d => !d.contract_parinte_id), [downstream])
  const overAlloc = useMemo(() => mame.filter(m => m.overAlloc), [mame])

  // ── KPI globale ─────────────────────────────────────────────────────────-─
  const totalUpstream = upstream.reduce((s, m) => s + Number(m.valoare_cu_acte ?? m.valoare_lei ?? 0), 0)
  const gTot = calcMetrics(downstream)
  const totalRamasGazpet = mame.reduce((s, m) => s + m.ramasGazpet, 0)

  return (
    <div>
      {/* Toggle + search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: G.surface, borderRadius: 8, padding: 4, border: `1px solid ${G.border}` }}>
          {[
            { val: 'mama', label: '🔗 Pe contract mamă' },
            { val: 'subc', label: '🏢 Pe subcontractor' },
          ].map(t => (
            <button key={t.val} onClick={() => setView(t.val)} style={{
              padding: '7px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: view === t.val ? G.purple + '33' : 'transparent',
              color: view === t.val ? G.purple : G.muted, fontWeight: 700, fontSize: 12.5,
            }}>{t.label}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={view === 'mama' ? '🔍 Caută contract / subcontractor...' : '🔍 Caută firmă...'}
          style={{ width: 240, padding: '8px 12px', background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 8, fontSize: 13, outline: 'none', colorScheme: 'dark' }} />
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <KPI icon="🔼" label="Valoare upstream" value={fmtRON(totalUpstream)} sub={`${upstream.length} contracte mamă`} color={G.blue} />
        <KPI icon="🔗" label="Total subcontractat" value={fmtRON(gTot.contractat)} sub={`${downstream.length} subcontracte · ${subcontractori.length} firme`} color={G.purple} />
        <KPI icon="✅" label="Rămas Gazpet (din mame)" value={fmtRON(totalRamasGazpet)} sub="valoare mamă − subcontractat" color={G.green} />
        <KPI icon={gTot.restPlata > 0.5 ? '⏳' : '✅'} label="Rest de plată subcontractori" value={fmtRON(gTot.restPlata)} sub="facturat (cu TVA) − plătit" color={gTot.restPlata > 0.5 ? G.orange : G.green} />
      </div>

      {/* Alerte */}
      {(orfane.length > 0 || overAlloc.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {orfane.length > 0 && (
            <div style={{ ...S.card, padding: '10px 14px', borderColor: G.red + '55', background: G.red + '12' }}>
              <span style={{ color: G.red, fontWeight: 700, fontSize: 13 }}>⚠️ {orfane.length} subcontracte fără contract mamă</span>
              <span style={{ color: G.muted, fontSize: 12 }}> — nu intră în consolidarea pe mamă: {orfane.map(d => d.numar_contract || d.denumire?.slice(0, 24)).join(' · ')}</span>
            </div>
          )}
          {overAlloc.length > 0 && (
            <div style={{ ...S.card, padding: '10px 14px', borderColor: G.yellow + '55', background: G.yellow + '12' }}>
              <span style={{ color: G.yellow, fontWeight: 700, fontSize: 13 }}>⚠️ {overAlloc.length} contracte mamă supra-subcontractate</span>
              <span style={{ color: G.muted, fontSize: 12 }}> — subcontractat &gt; valoarea contractului: {overAlloc.map(m => `Nr.${m.numar_contract || m.id} (${fmtRON(m.contractat - m.valMama)} peste)`).join(' · ')}</span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: G.muted }}>⏳ Se încarcă...</div>
      ) : view === 'mama' ? (
        // ── VEDERE PE CONTRACT MAMĂ ──────────────────────────────────────────
        mameFiltrate.length === 0 ? (
          <div style={{ ...S.card, padding: 40, textAlign: 'center', color: G.muted }}>Niciun contract mamă cu subcontracte.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mameFiltrate.map(m => {
              const procRamas = m.valMama > 0 ? Math.round((m.ramasGazpet / m.valMama) * 100) : 0
              const procFacturat = m.contractat > 0 ? Math.round((m.facturatNet / m.contractat) * 100) : 0
              const eEur = Number(m.valoare_eur || 0) > 0
              return (
                <div key={m.id} style={{ ...S.card, padding: '14px 18px', borderLeft: `4px solid ${m.overAlloc ? G.red : G.blue}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>
                        Nr. {m.numar_contract || '—'} · {m.beneficiar_name || m.partener_text || ''}
                      </div>
                      <div style={{ fontSize: 12.5, color: G.muted, marginTop: 2, wordBreak: 'break-word' }}>{m.denumire}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: G.blue }}>{fmtRON(m.valMama)}</div>
                      {eEur && <div style={{ fontSize: 12, fontWeight: 700, color: G.muted }}>💶 {fmtEUR(m.valoare_eur)}</div>}
                    </div>
                  </div>

                  {/* Waterfall valoare → subcontractat → rămas */}
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, padding: '10px 14px', background: G.bg, borderRadius: 8, fontSize: 12.5 }}>
                    <div><span style={{ color: G.muted }}>Valoare contract</span><div style={{ color: G.text, fontWeight: 700 }}>{fmtRON(m.valMama)}</div></div>
                    <div><span style={{ color: G.muted }}>− Subcontractat</span><div style={{ color: G.purple, fontWeight: 700 }}>{fmtRON(m.contractat)}</div></div>
                    <div><span style={{ color: G.muted }}>= Rămas Gazpet</span><div style={{ color: m.overAlloc ? G.red : G.green, fontWeight: 800 }}>{fmtRON(m.ramasGazpet)}{m.overAlloc ? ' ⚠️' : ''}</div></div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 18 }}>
                      <div><span style={{ color: G.muted }}>Facturat subc. (net)</span><div style={{ color: G.green, fontWeight: 700 }}>{fmtRON(m.facturatNet)}</div></div>
                      <div><span style={{ color: G.muted }}>Plătit (cu TVA)</span><div style={{ color: G.blue, fontWeight: 700 }}>{fmtRON(m.platit)}</div></div>
                      <div><span style={{ color: G.muted }}>Rest de plată</span><div style={{ color: m.restPlata > 0.5 ? G.orange : G.green, fontWeight: 700 }}>{Math.abs(m.restPlata) < 0.5 ? '0 lei' : fmtRON(m.restPlata)}</div></div>
                    </div>
                  </div>

                  {/* Bare */}
                  <div style={{ display: 'flex', gap: 24, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: G.muted }}>Rămas Gazpet</span>
                      <Bar pct={procRamas} color={m.overAlloc ? G.red : G.green} />
                      <span style={{ fontSize: 11, color: G.muted }}>{procRamas}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: G.muted }}>Subc. facturat</span>
                      <Bar pct={procFacturat} color={G.green} />
                      <span style={{ fontSize: 11, color: G.muted }}>{procFacturat}%</span>
                    </div>
                    <button onClick={() => toggle('m' + m.id)} style={{
                      marginLeft: 'auto', padding: '5px 12px', background: G.purple + '22', color: G.purple,
                      border: `1px solid ${G.purple}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                    }}>{expanded['m' + m.id] ? '▾ Ascunde' : `▸ ${m.copii.length} subcontracte`}</button>
                  </div>

                  {expanded['m' + m.id] && <CopiiTable copii={m.copii} showFirma />}
                </div>
              )
            })}
          </div>
        )
      ) : (
        // ── VEDERE PE SUBCONTRACTOR ───────────────────────────────────────────
        subcFiltrati.length === 0 ? (
          <div style={{ ...S.card, padding: 40, textAlign: 'center', color: G.muted }}>Niciun subcontractor.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {subcFiltrati.map(s => {
              const procPlatit = s.facturatTva > 0 ? Math.round((s.platit / s.facturatTva) * 100) : 0
              return (
                <div key={s.firma} style={{ ...S.card, padding: '14px 18px', borderLeft: `4px solid ${G.purple}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: G.text }}>🏢 {s.firma}</div>
                      <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>{s.nr} {s.nr === 1 ? 'contract' : 'contracte'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: G.purple }}>{fmtRON(s.contractat)}</div>
                      <div style={{ fontSize: 11, color: G.muted }}>contractat total</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, padding: '10px 14px', background: G.bg, borderRadius: 8, fontSize: 12.5 }}>
                    <div><span style={{ color: G.muted }}>Facturat (net)</span><div style={{ color: G.green, fontWeight: 700 }}>{fmtRON(s.facturatNet)}</div></div>
                    <div><span style={{ color: G.muted }}>Rest de facturat</span><div style={{ color: s.restFacturat > 0.5 ? G.text : G.green, fontWeight: 700 }}>{Math.abs(s.restFacturat) < 0.5 ? '0 lei' : fmtRON(s.restFacturat)}</div></div>
                    <div><span style={{ color: G.muted }}>Plătit (cu TVA)</span><div style={{ color: G.blue, fontWeight: 700 }}>{fmtRON(s.platit)}</div></div>
                    <div><span style={{ color: G.muted }}>Rest de plată</span><div style={{ color: s.restPlata > 0.5 ? G.orange : G.green, fontWeight: 800 }}>{Math.abs(s.restPlata) < 0.5 ? '0 lei' : fmtRON(s.restPlata)}</div></div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: G.muted }}>Plătit</span>
                      <Bar pct={procPlatit} color={G.blue} />
                      <span style={{ fontSize: 11, color: G.muted }}>{procPlatit}%</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', marginTop: 10 }}>
                    <button onClick={() => toggle('s' + s.firma)} style={{
                      marginLeft: 'auto', padding: '5px 12px', background: G.purple + '22', color: G.purple,
                      border: `1px solid ${G.purple}44`, borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                    }}>{expanded['s' + s.firma] ? '▾ Ascunde' : '▸ Vezi contractele'}</button>
                  </div>

                  {expanded['s' + s.firma] && <CopiiTable copii={s.copii} showFirma={false} />}
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
