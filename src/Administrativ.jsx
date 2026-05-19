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
import TabDocumenteFirma from './TabDocumenteFirma.jsx'

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
const BUGET_LUNAR_RON = 50.0

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
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [period])

  // KPI grand total
  const grandTotalUsd = chatbotStats.costUsd + scannerStats.totalCost
  const grandTotalRon = grandTotalUsd * USD_TO_RON
  const restantBuget = BUGET_LUNAR_RON - grandTotalRon

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
                <div style={{marginTop:10, padding:'8px 12px', background: restantBuget >= 0 ? G.green+'15' : G.red+'15',
                  border:`1px solid ${restantBuget >= 0 ? G.green : G.red}55`, borderRadius:6,
                  color: restantBuget >= 0 ? G.green : G.red, fontWeight:700}}>
                  Buget lunar: {BUGET_LUNAR_RON} RON · Restant: <b>{restantBuget.toFixed(2)} RON</b>
                  {restantBuget < 0 && ' ⚠ depășit'}
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
          .select('id, name, email, is_owner')
          .eq('id', user.id)
          .single()
        setProfile(data)
      }
      setLoadingProfile(false)
    })()
    return () => { cancelled = true }
  }, [])

  const isOwner = profile?.is_owner === true

  const tabs = [
    { key: 'documente',  icon: '📁', label: 'Documente firmă' },
    { key: 'furnizori',  icon: '🏢', label: 'Furnizori' },
    { key: 'ticketing',  icon: '🎫', label: 'Ticketing' },
    { key: 'contracte_terti', icon: '📃', label: 'Contracte cu terți' },
    { key: 'contracte',  icon: '📜', label: 'Contracte comerciale' },
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

      {/* Tab Costuri AI (real, nu placeholder) */}
      {tab === 'costuri_ai' && isOwner && <TabCosturiAI />}

      {/* Etapa 14: Tab Ticketing activ (modul Tichete filtrat pe departament) */}
      {tab === 'ticketing' && <Tichete filterDepartament="administrativ" noLayout={true} />}

      {/* Etapa 15 Faza 1: Tab Contracte cu terți (cu listă beneficiari real) */}
      {tab === 'contracte_terti' && <ContracteTertiTab />}

      {/* Etapa 16: Tab Documente firmă (funcțional cu AI parser + alerte expirare) */}
      {tab === 'documente' && <TabDocumenteFirma />}

      {/* Placeholder pentru tab-urile încă neimplementate */}
      {tab !== 'costuri_ai' && tab !== 'ticketing' && tab !== 'contracte_terti' && tab !== 'documente' && (
        <div style={{...S.card, padding:50, textAlign:'center'}}>
          <div style={{fontSize:48, marginBottom:14}}>
            {tab === 'furnizori' && '🏢'}
            {tab === 'contracte' && '📜'}
          </div>
          <div style={{fontSize:18, fontWeight:700, color:G.text, marginBottom:8}}>
            {tab === 'furnizori' && 'Furnizori'}
            {tab === 'contracte' && 'Contracte Comerciale'}
          </div>
          <div style={{fontSize:13, color:G.muted, maxWidth:520, margin:'0 auto 16px', lineHeight:1.6}}>
            {tab === 'furnizori' && (
              <>Bază de date <strong>furnizori</strong> cu:<br/>
              Date contact · Contracte · Plăți · Istoric comenzi · Termenele de plată</>
            )}
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
