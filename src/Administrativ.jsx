// ===========================================================================
// MODUL ADMINISTRATIV — Documente firma · Furnizori · Ticketing · Costuri AI
// ===========================================================================
// 18.05.2026: adăugat tab „💰 Costuri AI" pentru monitorizare costuri
//   - Chatbot Nenicu (Haiku 4.5: $1/MTok in, $5/MTok out)
//   - Scanner Documente AI (Sonnet 4.5: $3/MTok in, $15/MTok out)
// Acces: doar is_owner (Razvan + Marilena) — date financiare sensibile
// ===========================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import Tichete from './Tichete.jsx'
import TicheteWidget from './TicheteWidget.jsx'
import ContracteTertiTab from './ContracteTertiTab.jsx'
import ContracteComerciale from './ContracteComerciale.jsx'
import DashboardSubcontractori from './DashboardSubcontractori.jsx'
import TabDocumenteFirma from './TabDocumenteFirma.jsx'
import Consumabile from './Consumabile.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  orange:'#F0883E', purple:'#A371F7', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149', hr:'#EC6CB9',
}

const S = {
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
}

// Pricing per 1M tokens (USD) — sincron cu Edge Functions
const PRICING = {
  chatbot_haiku:  { input: 1.0, output: 5.0 },
  scanner_sonnet: { input: 3.0, output: 15.0 },
}
const USD_TO_RON = 5.0
const BUGET_LUNAR_RON = 250.0   // 11.06.2026: buget stabilit de Razvan

// ===========================================================================
// SUBCOMPONENTE
// ===========================================================================

function KPICard({ icon, label, value, color, sub }) {
  return (
    <div style={{...S.card, padding:'14px 18px', borderColor: color ? color+'33' : G.border}}>
      <div style={{fontSize:11, color: color || G.muted, fontWeight:700, marginBottom:6, textTransform:'uppercase', letterSpacing:.4, display:'flex', alignItems:'center', gap:6}}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{fontSize:28, fontWeight:800, color:G.text, lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:10, color:G.dim, marginTop:6}}>{sub}</div>}
    </div>
  )
}

function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

// ===========================================================================
// TAB COSTURI AI
// ===========================================================================

function TabCosturiAI() {
  const [period, setPeriod] = useState(30)  // 7 / 30 / 0 (all-time)
  const [chatbotStats, setChatbotStats] = useState({ users: [], totalQueries: 0, totalIn: 0, totalOut: 0, costUsd: 0 })
  const [scannerStats, setScannerStats] = useState({ logs: [], byUser: [], totalScans: 0, totalCost: 0, totalSaved: 0 })
  const [edgeStats, setEdgeStats] = useState({ rows: [], totalUsd: 0 })   // 11.06: parsere PDF (ai_usage_log)
  const [loading, setLoading] = useState(true)
  const [showRawLogs, setShowRawLogs] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)

      // ============ CHATBOT — cumulativ all-time per user ============
      const { data: chatbotUsers, error: cbErr } = await supabase
        .from('chatbot_usage')
        .select('user_id, total_queries, total_input_tokens, total_output_tokens, last_query_at, queries_today')
        .order('total_queries', { ascending: false })

      // Get profile names
      const userIds = (chatbotUsers || []).map(u => u.user_id).filter(Boolean)
      const { data: profiles } = userIds.length > 0
        ? await supabase.from('profiles').select('id, name, email').in('id', userIds)
        : { data: [] }
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

      const enrichedChatbot = (chatbotUsers || []).map(u => {
        const costUsd = (
          (u.total_input_tokens || 0) * PRICING.chatbot_haiku.input +
          (u.total_output_tokens || 0) * PRICING.chatbot_haiku.output
        ) / 1_000_000
        const p = profileMap[u.user_id]
        return {
          ...u,
          name: p?.name || p?.email || 'Unknown',
          email: p?.email || '—',
          costUsd,
          costRon: costUsd * USD_TO_RON,
        }
      })

      const totalQueries = enrichedChatbot.reduce((s, u) => s + (u.total_queries || 0), 0)
      const totalIn  = enrichedChatbot.reduce((s, u) => s + (u.total_input_tokens || 0), 0)
      const totalOut = enrichedChatbot.reduce((s, u) => s + (u.total_output_tokens || 0), 0)
      const totalCostCb = enrichedChatbot.reduce((s, u) => s + u.costUsd, 0)

      // ============ SCANNER — filtered pe perioadă ============
      let scannerQuery = supabase.from('scanner_logs')
        .select('id, user_id, user_email, module, detected_tip, detected_entity, confidence_pct, cost_usd, tokens_in, tokens_out, duration_ms, success, saved_to_db, created_at, error_msg')
        .order('created_at', { ascending: false })

      if (period > 0) {
        const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString()
        scannerQuery = scannerQuery.gte('created_at', since)
      }
      scannerQuery = scannerQuery.limit(500)

      const { data: scannerLogs, error: scErr } = await scannerQuery

      // Aggregate by user
      const byUserMap = {}
      let totalScans = 0, totalScanCost = 0, totalSaved = 0

      for (const log of scannerLogs || []) {
        totalScans++
        if (log.cost_usd) totalScanCost += Number(log.cost_usd)
        if (log.saved_to_db) totalSaved++

        const key = log.user_email || log.user_id || 'unknown'
        if (!byUserMap[key]) byUserMap[key] = { email: log.user_email, scans: 0, saved: 0, errors: 0, costUsd: 0, modules: new Set() }
        byUserMap[key].scans++
        if (log.saved_to_db) byUserMap[key].saved++
        if (!log.success) byUserMap[key].errors++
        if (log.cost_usd) byUserMap[key].costUsd += Number(log.cost_usd)
        if (log.module) byUserMap[key].modules.add(log.module)
      }

      const scannerByUser = Object.values(byUserMap)
        .map(u => ({
          ...u,
          costRon: u.costUsd * USD_TO_RON,
          modules: Array.from(u.modules || []).join(', '),
        }))
        .sort((a, b) => b.scans - a.scans)

      if (cancelled) return

      if (cbErr) console.error('chatbot fetch err', cbErr)
      if (scErr) console.error('scanner fetch err', scErr)

      setChatbotStats({ users: enrichedChatbot, totalQueries, totalIn, totalOut, costUsd: totalCostCb })
      setScannerStats({ logs: scannerLogs || [], byUser: scannerByUser, totalScans, totalCost: totalScanCost, totalSaved })

      // 11.06.2026: costuri REALE edge functions (parsere PDF) — luna curentă
      const { data: edgeRows } = await supabase.from('v_ai_cost_luna_curenta').select('*')
      if (cancelled) return
      const eRows = edgeRows || []
      setEdgeStats({ rows: eRows, totalUsd: eRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0) })
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [period])

  // KPI grand total (chatbot + scanner + parsere PDF edge)
  const grandTotalUsd = chatbotStats.costUsd + scannerStats.totalCost + edgeStats.totalUsd
  const grandTotalRon = grandTotalUsd * USD_TO_RON
  const restantBuget = BUGET_LUNAR_RON - grandTotalRon
  const pctBuget = Math.min(100, (grandTotalRon / BUGET_LUNAR_RON) * 100)
  const alertaBuget = pctBuget >= 80

  // Total useri unici (combinat)
  const uniqueUsers = useMemo(() => {
    const emails = new Set()
    chatbotStats.users.forEach(u => u.email && emails.add(u.email))
    scannerStats.byUser.forEach(u => u.email && emails.add(u.email))
    return emails.size
  }, [chatbotStats.users, scannerStats.byUser])

  return (
    <div>
      {/* Header + Filtru perioadă */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18, flexWrap:'wrap', gap:10}}>
        <div style={{fontSize:11, color:G.muted}}>
          📊 Monitorizare costuri AI · Chatbot Nenicu (Haiku 4.5) + Scanner Documente (Sonnet 4.5)
        </div>
        <div style={{display:'flex', gap:6}}>
          {[
            { key: 7, label: '7 zile' },
            { key: 30, label: '30 zile' },
            { key: 0, label: 'Tot timpul' },
          ].map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              style={{
                padding:'6px 14px', borderRadius:6,
                border:`1px solid ${period === p.key ? G.orange : G.border}`,
                background: period === p.key ? G.orange+'22' : 'transparent',
                color: period === p.key ? G.orange : G.muted,
                fontSize:11, fontWeight:700, cursor:'pointer',
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{padding:60, textAlign:'center', color:G.muted, fontSize:13}}>⏳ Se calculează costurile…</div>
      )}

      {!loading && (
        <>
          {/* GRAND TOTAL CARD */}
          <div style={{
            ...S.card, padding:'24px 28px', marginBottom:18,
            background: `linear-gradient(135deg, ${G.orange}11, ${G.purple}11)`,
            borderColor: G.orange+'44',
          }}>
            <div style={{fontSize:11, color:G.muted, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', marginBottom:10}}>
              💰 Cost total AI {period > 0 ? `· Scanner ult. ${period}z + Chatbot all-time` : '· All-time'}
            </div>
            <div style={{display:'flex', gap:30, alignItems:'flex-start', flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:46, fontWeight:900, color:G.text, lineHeight:1}}>
                  {grandTotalRon.toFixed(2)} <span style={{fontSize:18, color:G.muted, fontWeight:500}}>RON</span>
                </div>
                <div style={{fontSize:13, color:G.dim, marginTop:6}}>
                  ${grandTotalUsd.toFixed(4)} USD · cursul aplicat 1 USD ≈ {USD_TO_RON} RON
                </div>
              </div>
              <div style={{flex:1, minWidth:280, fontSize:12, color:G.muted, lineHeight:1.8}}>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                  <span>💬 Chatbot Nenicu (all-time):</span>
                  <b style={{color:G.text}}>${chatbotStats.costUsd.toFixed(4)} · {(chatbotStats.costUsd * USD_TO_RON).toFixed(2)} RON</b>
                </div>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                  <span>📷 Scanner AI ({period > 0 ? `${period}z` : 'all-time'}):</span>
                  <b style={{color:G.text}}>${scannerStats.totalCost.toFixed(4)} · {(scannerStats.totalCost * USD_TO_RON).toFixed(2)} RON</b>
                </div>
                <div style={{display:'flex', justifyContent:'space-between'}}>
                  <span>📄 Parsere PDF — contracte/anexe/ITP (luna curentă):</span>
                  <b style={{color:G.text}}>${edgeStats.totalUsd.toFixed(4)} · {(edgeStats.totalUsd * USD_TO_RON).toFixed(2)} RON</b>
                </div>
                {edgeStats.rows.length > 0 && (
                  <div style={{fontSize:10.5, color:G.dim, paddingLeft:18}}>
                    {edgeStats.rows.map(r => `${r.function_name}: ${r.apeluri} apeluri · ${Number(r.cost_ron_estimat).toFixed(2)} RON`).join(' · ')}
                  </div>
                )}
                <div style={{marginTop:10, padding:'10px 12px', background: restantBuget >= 0 ? (alertaBuget ? G.orange+'15' : G.green+'15') : G.red+'15',
                  border:`1px solid ${restantBuget >= 0 ? (alertaBuget ? G.orange : G.green) : G.red}55`, borderRadius:6}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6,
                    color: restantBuget >= 0 ? (alertaBuget ? G.orange : G.green) : G.red, fontWeight:700, fontSize:12}}>
                    <span>Buget lunar: {BUGET_LUNAR_RON} RON · Restant: <b>{restantBuget.toFixed(2)} RON</b></span>
                    <span>{pctBuget.toFixed(1)}%{restantBuget < 0 ? ' ⚠ DEPĂȘIT' : alertaBuget ? ' ⚠ peste 80%!' : ''}</span>
                  </div>
                  <div style={{height:10, background:G.bg, borderRadius:6, overflow:'hidden'}}>
                    <div style={{height:'100%', width:`${pctBuget}%`, borderRadius:6, transition:'width .4s',
                      background: restantBuget < 0 ? G.red : alertaBuget ? G.orange : G.green}} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* KPI Row */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:24}}>
            <KPICard icon="💬" label="Întrebări Chatbot" value={fmtNum(chatbotStats.totalQueries)} color={G.blue}
              sub={`${fmtNum(chatbotStats.totalIn + chatbotStats.totalOut)} tokens`} />
            <KPICard icon="📷" label="Scanări AI" value={scannerStats.totalScans} color={G.purple}
              sub={`${scannerStats.totalSaved} salvate (${scannerStats.totalScans > 0 ? Math.round(scannerStats.totalSaved / scannerStats.totalScans * 100) : 0}%)`} />
            <KPICard icon="👥" label="Useri activi" value={uniqueUsers} color={G.orange}
              sub={`${chatbotStats.users.length} chatbot · ${scannerStats.byUser.length} scanner`} />
            <KPICard icon="💵" label="Cost/lună mediu" value={`${(grandTotalRon).toFixed(1)} RON`} color={G.green}
              sub={`Pace: ~${(grandTotalRon / Math.max(1, period || 30) * 30).toFixed(2)} RON/lună`} />
          </div>

          {/* ═══════════════ CHATBOT SECTION ═══════════════ */}
          <div style={{fontSize:15, fontWeight:700, color:G.text, marginBottom:12, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:22}}>💬</span> Chatbot Nenicu · top utilizatori (cumulativ all-time)
          </div>

          {chatbotStats.users.length === 0 && (
            <div style={{...S.card, padding:30, textAlign:'center', color:G.muted, fontSize:13, marginBottom:24, border:`1px dashed ${G.border2}`}}>
              Niciun utilizator de chatbot încă.
            </div>
          )}

          {chatbotStats.users.length > 0 && (
            <div style={{...S.card, overflow:'hidden', marginBottom:24}}>
              <div style={{
                display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 90px 110px 100px 90px 100px',
                padding:'10px 16px', background:G.surface, borderBottom:`1px solid ${G.border}`,
                fontSize:10, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5,
              }}>
                <div>Utilizator</div>
                <div style={{textAlign:'right'}}>Întrebări</div>
                <div style={{textAlign:'right'}}>Tokens in</div>
                <div style={{textAlign:'right'}}>Tokens out</div>
                <div style={{textAlign:'right'}}>Cost USD</div>
                <div style={{textAlign:'right'}}>Cost RON</div>
              </div>
              {chatbotStats.users.map((u, i) => (
                <div key={u.user_id} style={{
                  display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 90px 110px 100px 90px 100px',
                  padding:'11px 16px', alignItems:'center',
                  borderBottom: i < chatbotStats.users.length - 1 ? `1px solid ${G.border}` : 'none',
                  fontSize:12,
                }}>
                  <div style={{minWidth:0}}>
                    <div style={{color:G.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.name}</div>
                    <div style={{fontSize:10, color:G.muted, marginTop:2}}>{u.email}</div>
                  </div>
                  <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums', fontWeight:600}}>{u.total_queries}</div>
                  <div style={{textAlign:'right', color:G.muted, fontVariantNumeric:'tabular-nums'}}>{fmtNum(u.total_input_tokens)}</div>
                  <div style={{textAlign:'right', color:G.muted, fontVariantNumeric:'tabular-nums'}}>{fmtNum(u.total_output_tokens)}</div>
                  <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>${u.costUsd.toFixed(5)}</div>
                  <div style={{textAlign:'right', color:G.blue, fontVariantNumeric:'tabular-nums', fontWeight:700}}>{u.costRon.toFixed(3)}</div>
                </div>
              ))}
              <div style={{
                display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 90px 110px 100px 90px 100px',
                padding:'12px 16px', background:G.bg, borderTop:`2px solid ${G.blue}55`,
                fontSize:12, fontWeight:700,
              }}>
                <div style={{color:G.blue}}>TOTAL Chatbot</div>
                <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>{chatbotStats.totalQueries}</div>
                <div style={{textAlign:'right', color:G.muted, fontVariantNumeric:'tabular-nums'}}>{fmtNum(chatbotStats.totalIn)}</div>
                <div style={{textAlign:'right', color:G.muted, fontVariantNumeric:'tabular-nums'}}>{fmtNum(chatbotStats.totalOut)}</div>
                <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>${chatbotStats.costUsd.toFixed(4)}</div>
                <div style={{textAlign:'right', color:G.blue, fontVariantNumeric:'tabular-nums'}}>{(chatbotStats.costUsd * USD_TO_RON).toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* ═══════════════ SCANNER SECTION ═══════════════ */}
          <div style={{fontSize:15, fontWeight:700, color:G.text, marginBottom:12, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:22}}>📷</span> Scanner Documente AI · top utilizatori ({period > 0 ? `ult. ${period} zile` : 'all-time'})
          </div>

          {scannerStats.byUser.length === 0 && (
            <div style={{...S.card, padding:30, textAlign:'center', color:G.muted, fontSize:13, marginBottom:24, border:`1px dashed ${G.border2}`}}>
              Nicio scanare în perioada selectată.
            </div>
          )}

          {scannerStats.byUser.length > 0 && (
            <div style={{...S.card, overflow:'hidden', marginBottom:24}}>
              <div style={{
                display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 70px 70px 70px minmax(0,1fr) 90px 100px',
                padding:'10px 16px', background:G.surface, borderBottom:`1px solid ${G.border}`,
                fontSize:10, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.5,
              }}>
                <div>Utilizator</div>
                <div style={{textAlign:'right'}}>Scanări</div>
                <div style={{textAlign:'right'}}>Salvate</div>
                <div style={{textAlign:'right'}}>Erori</div>
                <div>Module</div>
                <div style={{textAlign:'right'}}>Cost USD</div>
                <div style={{textAlign:'right'}}>Cost RON</div>
              </div>
              {scannerStats.byUser.map((u, i) => (
                <div key={u.email || i} style={{
                  display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 70px 70px 70px minmax(0,1fr) 90px 100px',
                  padding:'11px 16px', alignItems:'center',
                  borderBottom: i < scannerStats.byUser.length - 1 ? `1px solid ${G.border}` : 'none',
                  fontSize:12,
                }}>
                  <div style={{minWidth:0, color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.email}</div>
                  <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums', fontWeight:600}}>{u.scans}</div>
                  <div style={{textAlign:'right', color:G.green, fontVariantNumeric:'tabular-nums'}}>{u.saved}</div>
                  <div style={{textAlign:'right', color: u.errors > 0 ? G.red : G.muted, fontVariantNumeric:'tabular-nums'}}>{u.errors}</div>
                  <div style={{color:G.muted, fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.modules}</div>
                  <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>${u.costUsd.toFixed(5)}</div>
                  <div style={{textAlign:'right', color:G.purple, fontVariantNumeric:'tabular-nums', fontWeight:700}}>{u.costRon.toFixed(3)}</div>
                </div>
              ))}
              <div style={{
                display:'grid', gridTemplateColumns:'minmax(0,1.6fr) 70px 70px 70px minmax(0,1fr) 90px 100px',
                padding:'12px 16px', background:G.bg, borderTop:`2px solid ${G.purple}55`,
                fontSize:12, fontWeight:700,
              }}>
                <div style={{color:G.purple}}>TOTAL Scanner</div>
                <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>{scannerStats.totalScans}</div>
                <div style={{textAlign:'right', color:G.green, fontVariantNumeric:'tabular-nums'}}>{scannerStats.totalSaved}</div>
                <div style={{textAlign:'right', color:G.muted}}>—</div>
                <div></div>
                <div style={{textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums'}}>${scannerStats.totalCost.toFixed(4)}</div>
                <div style={{textAlign:'right', color:G.purple, fontVariantNumeric:'tabular-nums'}}>{(scannerStats.totalCost * USD_TO_RON).toFixed(2)}</div>
              </div>
            </div>
          )}

          {/* Toggle raw logs */}
          <button onClick={() => setShowRawLogs(s => !s)}
            style={{
              padding:'8px 14px', background:'transparent', color:G.muted,
              border:`1px solid ${G.border}`, borderRadius:6, cursor:'pointer', fontSize:12, marginBottom:14,
            }}>
            {showRawLogs ? '▼' : '▶'} {showRawLogs ? 'Ascunde' : 'Arată'} log-uri detaliate ({scannerStats.logs.length} înregistrări)
          </button>

          {showRawLogs && scannerStats.logs.length > 0 && (
            <div style={{...S.card, overflow:'hidden', marginBottom:18}}>
              <div style={{maxHeight:400, overflowY:'auto'}}>
                {scannerStats.logs.map((l, i) => {
                  const dt = new Date(l.created_at)
                  const dtStr = dt.toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })
                  const statusColor = !l.success ? G.red : (l.saved_to_db ? G.green : G.yellow)
                  const statusIcon = !l.success ? '❌' : (l.saved_to_db ? '✓' : '⏸')
                  return (
                    <div key={l.id} style={{
                      padding:'10px 16px',
                      borderBottom: i < scannerStats.logs.length - 1 ? `1px solid ${G.border}` : 'none',
                      display:'grid', gridTemplateColumns:'24px minmax(0,1fr) minmax(0,1.4fr) 90px 70px 80px 90px',
                      gap:10, alignItems:'center', fontSize:11,
                    }}>
                      <div style={{fontSize:14}}>{statusIcon}</div>
                      <div style={{color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {l.detected_tip || (l.error_msg ? `ERR: ${l.error_msg.substring(0, 40)}` : '—')}
                      </div>
                      <div style={{color:G.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {l.detected_entity || '—'} · {l.user_email}
                      </div>
                      <div style={{color:G.dim, fontFamily:'monospace', fontSize:10}}>{l.module}</div>
                      <div style={{color:G.dim, fontVariantNumeric:'tabular-nums', textAlign:'right'}}>{l.duration_ms || '—'}ms</div>
                      <div style={{color: l.confidence_pct >= 85 ? G.green : l.confidence_pct >= 70 ? G.yellow : G.red, fontVariantNumeric:'tabular-nums', textAlign:'right', fontWeight:600}}>
                        {l.confidence_pct != null ? `${l.confidence_pct}%` : '—'}
                      </div>
                      <div style={{color:G.text, fontVariantNumeric:'tabular-nums', textAlign:'right'}}>
                        {l.cost_usd ? `$${Number(l.cost_usd).toFixed(5)}` : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{padding:'8px 16px', fontSize:10, color:G.dim, background:G.bg, borderTop:`1px solid ${G.border}`}}>
                Limit 500 înregistrări · dată/oră · tip detectat · entitate (vehicul/angajat) · modul · durată ms · încredere · cost
              </div>
            </div>
          )}

          {/* Note */}
          <div style={{padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:8, fontSize:10, color:G.muted, lineHeight:1.7}}>
            <b style={{color:G.text}}>📋 Note:</b>
            <ul style={{margin:'6px 0 0 18px', padding:0}}>
              <li>Costurile sunt calculate la prețul Anthropic API: Haiku 4.5 ($1/$5 per MTok) · Sonnet 4.5 ($3/$15 per MTok)</li>
              <li>Chatbot afișează cumulativ all-time (BD nu păstrează istoric daily detaliat)</li>
              <li>Scanner afișează filtrat pe perioada selectată cu detalii din scanner_logs</li>
              <li>Curs USD→RON aplicat: <b style={{color:G.text}}>1 USD ≈ {USD_TO_RON} RON</b> (aproximativ, pentru orientare)</li>
              <li>Easter eggs (răspunsuri pre-definite chatbot) costă <b style={{color:G.green}}>0 USD</b> — nu sunt incluse</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

// ===========================================================================
// TAB FURNIZORI — Faza 2 (bază de date + istoric comenzi + cheltuieli)
// ===========================================================================

const fLei = (n) => (n == null ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei')
const fData = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const fInput = { width:'100%', padding:'9px 11px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13, boxSizing:'border-box' }
const fLabel = { fontSize:12, color:G.muted, marginBottom:4, display:'block' }
const STATUS_COMANDA = {
  draft:{ t:'Draft', c:G.dim }, emisa:{ t:'Emisă', c:G.blue }, confirmata:{ t:'Confirmată', c:G.purple },
  receptionata:{ t:'Recepționată', c:G.yellow }, finalizata:{ t:'Finalizată', c:G.green }, anulata:{ t:'Anulată', c:G.red },
}

function FurnizorModal({ item, onClose, onDone }) {
  const edit = !!item?.id
  const [f, setF] = useState({
    nume: item?.nume || '', cui: item?.cui || '', persoana_contact: item?.persoana_contact || '',
    telefon: item?.telefon || '', email: item?.email || '', adresa: item?.adresa || '',
    iban: item?.iban || '', termen_plata_zile: item?.termen_plata_zile ?? '', observatii: item?.observatii || '',
    activ: item?.activ ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const salveaza = async () => {
    if (!f.nume.trim()) { setErr('Numele e obligatoriu.'); return }
    setBusy(true); setErr('')
    try {
      const payload = {
        nume: f.nume.trim(), cui: f.cui.trim() || null, persoana_contact: f.persoana_contact.trim() || null,
        telefon: f.telefon.trim() || null, email: f.email.trim() || null, adresa: f.adresa.trim() || null,
        iban: f.iban.trim() || null, termen_plata_zile: f.termen_plata_zile !== '' ? Number(f.termen_plata_zile) : null,
        observatii: f.observatii.trim() || null, activ: f.activ,
      }
      const { error } = edit
        ? await supabase.from('logistica_furnizori').update(payload).eq('id', item.id)
        : await supabase.from('logistica_furnizori').insert(payload)
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(560px,100%)', padding:24, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:18 }}>{edit ? '✏️ Editează furnizor' : '➕ Furnizor nou'}</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 160px', gap:12, marginBottom:12 }}>
          <div><label style={fLabel}>Denumire <span style={{ color:G.red }}>*</span></label><input style={fInput} autoFocus value={f.nume} onChange={e => set('nume', e.target.value)} /></div>
          <div><label style={fLabel}>CUI</label><input style={fInput} value={f.cui} onChange={e => set('cui', e.target.value)} placeholder="RO..." /></div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
          <div><label style={fLabel}>Persoană contact</label><input style={fInput} value={f.persoana_contact} onChange={e => set('persoana_contact', e.target.value)} /></div>
          <div><label style={fLabel}>Telefon</label><input style={fInput} value={f.telefon} onChange={e => set('telefon', e.target.value)} /></div>
        </div>
        <div style={{ marginBottom:12 }}><label style={fLabel}>Email</label><input style={fInput} value={f.email} onChange={e => set('email', e.target.value)} /></div>
        <div style={{ marginBottom:12 }}><label style={fLabel}>Adresă</label><input style={fInput} value={f.adresa} onChange={e => set('adresa', e.target.value)} /></div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:12, marginBottom:12 }}>
          <div><label style={fLabel}>IBAN</label><input style={fInput} value={f.iban} onChange={e => set('iban', e.target.value)} /></div>
          <div><label style={fLabel}>Termen plată (zile)</label><input type="number" min="0" style={fInput} value={f.termen_plata_zile} onChange={e => set('termen_plata_zile', e.target.value)} placeholder="30" /></div>
        </div>
        <div style={{ marginBottom:12 }}><label style={fLabel}>Observații</label><input style={fInput} value={f.observatii} onChange={e => set('observatii', e.target.value)} /></div>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginBottom:8 }}>
          <input type="checkbox" checked={f.activ} onChange={e => set('activ', e.target.checked)} /> Furnizor activ
        </label>
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
          <button onClick={onClose} disabled={busy} style={{ padding:'9px 16px', background:'transparent', color:G.muted, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>Anulează</button>
          <button onClick={salveaza} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

function FurnizorDrawer({ furnizor, onClose, onEdit }) {
  const [loading, setLoading] = useState(true)
  const [comenzi, setComenzi] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('comenzi_furnizor')
        .select('id, numar_comanda, data_emitere, status, furnizor_contract_id, contract:furnizor_contract_id(id, partener_text, tip_contract), comenzi_furnizor_linii(cantitate, pret_unitar)')
        .eq('furnizor_id', furnizor.id)
        .order('data_emitere', { ascending: false })
      if (cancelled) return
      setComenzi(data || []); setLoading(false)
    })()
    return () => { cancelled = true }
  }, [furnizor.id])

  const valoareComanda = (c) => (c.comenzi_furnizor_linii || []).reduce((a, l) => a + (Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0), 0)
  const total = comenzi.reduce((a, c) => a + valoareComanda(c), 0)
  const contracte = useMemo(() => {
    const map = new Map()
    for (const c of comenzi) if (c.contract && !map.has(c.contract.id)) map.set(c.contract.id, c.contract)
    return [...map.values()]
  }, [comenzi])

  const Row = ({ label, value }) => value ? (
    <div style={{ display:'flex', gap:10, padding:'6px 0', fontSize:13, borderBottom:`1px solid ${G.border2}` }}>
      <div style={{ width:130, color:G.muted, flexShrink:0 }}>{label}</div>
      <div style={{ color:G.text }}>{value}</div>
    </div>
  ) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:999, display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:'min(560px,100%)', height:'100%', background:G.surface, borderLeft:`1px solid ${G.border}`, padding:24, overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:16 }}>
          <div>
            <div style={{ fontSize:20, fontWeight:800, display:'flex', alignItems:'center', gap:9 }}>🏢 {furnizor.nume}
              {!furnizor.activ && <span style={{ fontSize:11, fontWeight:700, color:G.muted, background:G.muted + '22', padding:'2px 8px', borderRadius:10 }}>inactiv</span>}
            </div>
            {furnizor.cui && <div style={{ fontSize:12.5, color:G.dim, marginTop:3 }}>CUI {furnizor.cui}</div>}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => onEdit(furnizor)} style={{ padding:'7px 12px', background:'transparent', color:G.orange, border:`1px solid ${G.orange}55`, borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:600 }}>✏️ Editează</button>
            <button onClick={onClose} style={{ padding:'7px 12px', background:'transparent', color:G.muted, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:12.5 }}>✕</button>
          </div>
        </div>

        <div style={{ display:'flex', gap:10, marginBottom:18 }}>
          <div style={{ flex:1, ...S.card, padding:'12px 14px' }}>
            <div style={{ fontSize:11, color:G.muted, marginBottom:4 }}>📦 Comenzi</div>
            <div style={{ fontSize:22, fontWeight:800, color:G.orange }}>{comenzi.length}</div>
          </div>
          <div style={{ flex:1, ...S.card, padding:'12px 14px' }}>
            <div style={{ fontSize:11, color:G.muted, marginBottom:4 }}>💰 Total cheltuit</div>
            <div style={{ fontSize:22, fontWeight:800, color:G.green }}>{fLei(total)}</div>
          </div>
        </div>

        <div style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>📇 Date contact</div>
        <div style={{ ...S.card, padding:'8px 16px', marginBottom:18 }}>
          <Row label="Persoană contact" value={furnizor.persoana_contact} />
          <Row label="Telefon" value={furnizor.telefon} />
          <Row label="Email" value={furnizor.email} />
          <Row label="Adresă" value={furnizor.adresa} />
          <Row label="IBAN" value={furnizor.iban} />
          <Row label="Termen plată" value={furnizor.termen_plata_zile != null ? `${furnizor.termen_plata_zile} zile` : null} />
          <Row label="Observații" value={furnizor.observatii} />
          {!furnizor.persoana_contact && !furnizor.telefon && !furnizor.email && !furnizor.adresa && !furnizor.iban && furnizor.termen_plata_zile == null && (
            <div style={{ padding:'10px 0', fontSize:12.5, color:G.dim }}>Niciun detaliu de contact completat. Apasă ✏️ Editează ca să-l adaugi.</div>
          )}
        </div>

        <div style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>📋 Istoric comenzi</div>
        {loading && <div style={{ padding:20, textAlign:'center', color:G.muted }}>Se încarcă...</div>}
        {!loading && !comenzi.length && <div style={{ ...S.card, padding:20, textAlign:'center', fontSize:13, color:G.dim, marginBottom:18 }}>Nicio comandă încă.</div>}
        {!loading && comenzi.length > 0 && (
          <div style={{ ...S.card, overflow:'hidden', marginBottom:18 }}>
            {comenzi.map(c => {
              const st = STATUS_COMANDA[c.status] || { t: c.status || '—', c: G.muted }
              return (
                <div key={c.id} style={{ display:'grid', gridTemplateColumns:'1fr 90px 110px', gap:8, alignItems:'center', padding:'10px 14px', borderBottom:`1px solid ${G.border}`, fontSize:13 }}>
                  <div>
                    <div style={{ fontWeight:700 }}>{c.numar_comanda || `#${c.id}`}</div>
                    <div style={{ fontSize:11, color:G.dim }}>{fData(c.data_emitere)}</div>
                  </div>
                  <div><span style={{ fontSize:11, fontWeight:700, color:st.c, background:st.c + '1e', padding:'3px 8px', borderRadius:10 }}>{st.t}</span></div>
                  <div style={{ textAlign:'right', fontWeight:700, color:G.green }}>{fLei(valoareComanda(c))}</div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>📃 Contracte legate</div>
        {!contracte.length && <div style={{ ...S.card, padding:16, fontSize:12.5, color:G.dim }}>Niciun contract legat de comenzile acestui furnizor. (Se leagă din comanda furnizor → câmpul Contract.)</div>}
        {contracte.length > 0 && (
          <div style={{ ...S.card, overflow:'hidden' }}>
            {contracte.map(ct => (
              <div key={ct.id} style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, fontSize:13 }}>
                <span style={{ fontWeight:700 }}>{ct.partener_text || `Contract #${ct.id}`}</span>
                {ct.tip_contract && <span style={{ marginLeft:8, fontSize:11, color:G.dim }}>{ct.tip_contract}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FurnizoriTab() {
  const [loading, setLoading] = useState(true)
  const [furnizori, setFurnizori] = useState([])
  const [statsMap, setStatsMap] = useState({})
  const [search, setSearch] = useState('')
  const [doarActivi, setDoarActivi] = useState(true)
  const [modal, setModal] = useState(null)     // {} nou | {...} editează
  const [drawer, setDrawer] = useState(null)   // furnizor selectat

  const loadAll = async () => {
    setLoading(true)
    try {
      const [rF, rS] = await Promise.all([
        supabase.from('logistica_furnizori').select('*').order('nume'),
        supabase.from('v_furnizori_stats').select('*'),
      ])
      const sm = {}
      for (const s of (rS.data || [])) sm[s.furnizor_id] = s
      setFurnizori(rF.data || []); setStatsMap(sm)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }
  useEffect(() => { loadAll() }, [])

  const filtered = useMemo(() => {
    let arr = furnizori
    if (doarActivi) arr = arr.filter(f => f.activ)
    if (search) {
      const q = search.toLowerCase()
      arr = arr.filter(f => (f.nume || '').toLowerCase().includes(q) || (f.cui || '').toLowerCase().includes(q))
    }
    return arr.slice().sort((a, b) => (statsMap[b.id]?.total_cheltuit || 0) - (statsMap[a.id]?.total_cheltuit || 0))
  }, [furnizori, statsMap, search, doarActivi])

  const totalCheltuit = Object.values(statsMap).reduce((a, s) => a + Number(s.total_cheltuit || 0), 0)
  const totalComenzi = Object.values(statsMap).reduce((a, s) => a + Number(s.nr_comenzi || 0), 0)

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16, alignItems:'stretch' }}>
        <KPICard icon="🏢" label="Furnizori activi" value={furnizori.filter(f => f.activ).length} color={G.orange} />
        <KPICard icon="📦" label="Comenzi total" value={totalComenzi} color={G.blue} />
        <KPICard icon="💰" label="Total cheltuit" value={fLei(totalCheltuit)} color={G.green} />
        <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:10 }}>
          <button onClick={loadAll} style={{ padding:'9px 14px', background:'transparent', color:G.muted, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 }}>🔄</button>
          <button onClick={() => setModal({})} style={{ ...S.btnP }}>➕ Furnizor nou</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
        <input style={{ ...fInput, maxWidth:340 }} placeholder="🔍 Caută după nume sau CUI..." value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, color:G.muted, cursor:'pointer' }}>
          <input type="checkbox" checked={doarActivi} onChange={e => setDoarActivi(e.target.checked)} /> Doar activi
        </label>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă furnizorii...</div>}
      {!loading && !filtered.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🏢</div>
          <div style={{ fontSize:15, fontWeight:700 }}>{search ? 'Niciun furnizor găsit.' : 'Niciun furnizor încă.'}</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 90px 130px 110px 70px', gap:10, padding:'10px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Furnizor</div><div>CUI</div><div style={{ textAlign:'center' }}>Comenzi</div><div style={{ textAlign:'right' }}>Total cheltuit</div><div>Ultima cmd.</div><div></div>
          </div>
          {filtered.map(f => {
            const st = statsMap[f.id] || {}
            return (
              <div key={f.id} onClick={() => setDrawer(f)}
                style={{ display:'grid', gridTemplateColumns:'1fr 130px 90px 130px 110px 70px', gap:10, alignItems:'center', padding:'12px 16px', fontSize:13.5, borderBottom:`1px solid ${G.border}`, cursor:'pointer', opacity: f.activ ? 1 : .55 }}>
                <div style={{ fontWeight:700 }}>{f.nume}
                  {(f.persoana_contact || f.telefon) && <div style={{ fontSize:11, color:G.dim, fontWeight:400 }}>{[f.persoana_contact, f.telefon].filter(Boolean).join(' · ')}</div>}
                </div>
                <div style={{ color:G.muted, fontSize:12 }}>{f.cui || '—'}</div>
                <div style={{ textAlign:'center', fontWeight:700 }}>{st.nr_comenzi || 0}</div>
                <div style={{ textAlign:'right', fontWeight:800, color: Number(st.total_cheltuit) > 0 ? G.green : G.dim }}>{fLei(st.total_cheltuit || 0)}</div>
                <div style={{ fontSize:12, color:G.dim }}>{fData(st.ultima_comanda)}</div>
                <div style={{ textAlign:'right' }}>
                  <button onClick={e => { e.stopPropagation(); setModal(f) }} style={{ padding:'5px 9px', background:'transparent', color:G.orange, border:`1px solid ${G.orange}44`, borderRadius:6, cursor:'pointer', fontSize:12 }}>✏️</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop:14, padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7 }}>
        <b style={{ color:G.text }}>💡 Cheltuielile</b> se calculează automat din comenzile emise în Achiziții (cantitate × preț pe linii). Click pe un furnizor pentru istoric comenzi + contracte legate.
        <b style={{ color:G.text }}> Plăți / sold furnizor</b> urmează după integrarea bancară.
      </div>

      {modal && <FurnizorModal item={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); loadAll() }} />}
      {drawer && <FurnizorDrawer furnizor={drawer} onClose={() => setDrawer(null)} onEdit={(f) => { setDrawer(null); setModal(f) }} />}
    </>
  )
}

// ===========================================================================
// COMPONENTĂ PRINCIPALĂ
// ===========================================================================

export default function AdministrativPage() {
  const [tab, setTab] = useState('documente')
  const [profile, setProfile] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('id, name, email, is_owner, can_manage_contracts')
          .eq('id', user.id)
          .single()
        setProfile(data)
      }
      setLoadingProfile(false)
    })()
    return () => { cancelled = true }
  }, [])

  const isOwner = profile?.is_owner === true
  const canManageContracts = profile?.can_manage_contracts === true

  const tabs = [
    { key: 'consumabile', icon: '🛒', label: 'Consumabile birou' },
    { key: 'documente',  icon: '📁', label: 'Documente firmă' },
    { key: 'furnizori',  icon: '🏢', label: 'Furnizori' },
    { key: 'ticketing',  icon: '🎫', label: 'Ticketing' },
    { key: 'contracte_terti', icon: '📃', label: 'Contracte cu terți' },
    { key: 'contracte',  icon: '📜', label: 'Contracte comerciale' },
    { key: 'subcontractori', icon: '🔗', label: 'Dashboard subcontractori' },
    { key: 'costuri_ai', icon: '💰', label: 'Costuri AI', ownerOnly: true },
  ].filter(t => !t.ownerOnly || isOwner)

  return (
    <div style={S.page}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
        <div>
          <div style={{fontSize:22, fontWeight:800, color:G.text, display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:28}}>🏢</span>
            <span style={{background: `linear-gradient(135deg, ${G.orange} 0%, ${G.purple} 100%)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>Administrativ</span>
          </div>
          <div style={{fontSize:12, color:G.muted, marginTop:4}}>
            Documente firmă · Furnizori · Ticketing · Contracte terți · Contracte{isOwner ? ' · Costuri AI' : ''}
          </div>
        </div>
      </div>

      {/* Etapa 14: Widget Tichete Administrativ */}
      {profile && <TicheteWidget departament="administrativ" profile={profile} accent={G.orange} />}

      <div style={{display:'flex', gap:6, marginBottom:18, padding:6, background:G.surface, borderRadius:12, border:`1px solid ${G.border}`, flexWrap:'wrap'}}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding:'10px 16px', borderRadius:8, border:'none', cursor:'pointer',
            background: tab === t.key ? (t.key === 'costuri_ai' ? G.green + '33' : G.orange + '33') : 'transparent',
            color: tab === t.key ? (t.key === 'costuri_ai' ? G.green : G.orange) : G.muted,
            fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:8,
          }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Consumabile birou — același component ca ruta /consumabile, aici e
          vederea de gestiune (cumulat + comandă). Ruta liberă e pentru toți. */}
      {tab === 'consumabile' && <Consumabile profile={profile} embedded={true} />}

      {/* Tab Costuri AI (real, nu placeholder) */}
      {tab === 'costuri_ai' && isOwner && <TabCosturiAI />}

      {/* Etapa 14: Tab Ticketing activ (modul Tichete filtrat pe departament) */}
      {tab === 'ticketing' && <Tichete filterDepartament="administrativ" noLayout={true} />}

      {/* Etapa 15 Faza 1: Tab Contracte cu terți (cu listă beneficiari real) */}
      {tab === 'contracte_terti' && <ContracteTertiTab />}

      {/* Etapa 15 Faza 2: Tab Contracte Comerciale — upstream/downstream + linii */}
      {tab === 'contracte' && <ContracteComerciale profile={profile} />}

      {/* 15.06.2026: Dashboard Subcontractori ↔ Contracte (consolidare mamă / firmă) */}
      {tab === 'subcontractori' && <DashboardSubcontractori profile={profile} />}

      {/* Etapa 16: Tab Documente firmă (funcțional cu AI parser + alerte expirare) */}
      {tab === 'documente' && <TabDocumenteFirma />}

      {/* Faza 2: Tab Furnizori (bază de date + istoric comenzi + cheltuieli) */}
      {tab === 'furnizori' && <FurnizoriTab />}

      {/* Placeholder pentru tab-urile încă neimplementate */}
      {tab !== 'costuri_ai' && tab !== 'ticketing' && tab !== 'contracte_terti' && tab !== 'contracte' && tab !== 'subcontractori' && tab !== 'documente' && tab !== 'furnizori' && tab !== 'consumabile' && (
        <div style={{...S.card, padding:50, textAlign:'center'}}>
          <div style={{fontSize:48, marginBottom:14}}>
            {tab === 'contracte' && '📜'}
          </div>
          <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>
            {tab === 'contracte' && 'Contracte Comerciale'}
          </div>
          <div style={{fontSize:13, color:G.muted, maxWidth:520, margin:'0 auto 16px', lineHeight:1.6}}>
            {tab === 'contracte' && (
              <>Contracte <strong>cu clienți și parteneri</strong>:<br/>
              Generare automată · Date firmă · Templates · Semnare digitală</>
            )}
          </div>
          <div style={{padding:'8px 16px', background:G.purple+'22', color:G.purple, borderRadius:6, display:'inline-block', fontSize:11, fontWeight:700, letterSpacing:.5}}>
            🚧 ÎN CURÂND — Faza 2
          </div>
        </div>
      )}
    </div>
  )
}
