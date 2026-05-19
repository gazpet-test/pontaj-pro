/* TicheteWidget.jsx - Widget compact pentru module (Etapa 14)
   Afișează tichetele atribuite utilizatorului + cele disponibile pentru preluare din dep.
   Hide complet când 0 tichete. Click pe row → navigate la /tichete?id=N
*/

import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117',surface:'#161B22',border:'#21262D',border2:'#30363D',text:'#E6EDF3',muted:'#8B949E',dim:'#6E7681',blue:'#58A6FF',green:'#3FB950',red:'#F85149',yellow:'#D29922',purple:'#BC8CFF',orange:'#F0883E',pink:'#F778BA' }

const URG_INFO = {
  urgent: { emoji:'🚨', color:G.red },
  normal: { emoji:'📝', color:G.yellow },
  scazut: { emoji:'📌', color:G.blue }
}

// Statusuri „active" — tichetele care încă necesită atenție
const STATUS_ACTIVE = ['deschis','in_analiza','programat_service','in_service','reparat','atribuit','in_lucru','rezolvat']

const fmtRelative = (d) => {
  if (!d) return ''
  const diff = (Date.now() - new Date(d).getTime()) / 1000
  if (diff < 60) return 'acum'
  if (diff < 3600) return `acum ${Math.floor(diff/60)}m`
  if (diff < 86400) return `acum ${Math.floor(diff/3600)}h`
  if (diff < 604800) return `acum ${Math.floor(diff/86400)}z`
  const dt = new Date(d)
  return dt.toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit' })
}

export default function TicheteWidget({ departament, profile, accent = G.blue }) {
  const [tichete, setTichete] = useState([])
  const [load, setLoad] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [preluareInProgres, setPreluareInProgres] = useState(null)
  const navigate = useNavigate()

  const load_ = useCallback(async () => {
    if (!profile?.id || !departament) { setLoad(false); return }
    setLoad(true)
    try {
      const { data, error } = await supabase
        .from('tichete')
        .select('id, numar_tichet, titlu, urgenta, status, persoana_responsabila, entitate_descriere, data_deschidere, created_at')
        .eq('departament', departament)
        .in('status', STATUS_ACTIVE)
        .or(`persoana_responsabila.eq.${profile.id},persoana_responsabila.is.null`)
        .order('urgenta', { ascending: true })  // urgent primul (alphabetic 'normal','scazut','urgent' - dar e ok)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      setTichete(data || [])
    } catch (e) {
      console.warn('TicheteWidget load error:', e.message)
      setTichete([])
    } finally {
      setLoad(false)
    }
  }, [departament, profile?.id])

  useEffect(() => { load_() }, [load_])

  const preia = async (e, tk) => {
    e.stopPropagation()
    if (preluareInProgres) return
    setPreluareInProgres(tk.id)
    try {
      const { error } = await supabase
        .from('tichete')
        .update({
          persoana_responsabila: profile.id,
          atribuit_de: profile.id,
          data_atribuire: new Date().toISOString(),
          asignat_la: 'intern',
          status: 'atribuit'
        })
        .eq('id', tk.id)
      if (error) throw error
      await load_()
    } catch (e) {
      console.warn('Preluare eroare:', e.message)
      alert('Eroare la preluare: ' + e.message)
    } finally {
      setPreluareInProgres(null)
    }
  }

  if (load) return null  // silent loading - widgetul e auxiliar

  // Separare în 2 secțiuni
  const aleMele = tichete.filter(t => t.persoana_responsabila === profile?.id)
  const disponibile = tichete.filter(t => !t.persoana_responsabila)

  // Hide complet dacă 0 tichete
  if (aleMele.length === 0 && disponibile.length === 0) return null

  const totalCount = aleMele.length + disponibile.length

  return (
    <div style={{
      background: G.surface,
      border: `1px solid ${accent}44`,
      borderRadius: 10,
      padding: '10px 14px',
      marginBottom: 14,
      boxShadow: `0 0 0 1px ${accent}22 inset`
    }}>
      {/* Header click → toggle */}
      <div onClick={() => setCollapsed(c => !c)} style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        cursor:'pointer', gap:10
      }}>
        <div style={{display:'flex', alignItems:'center', gap:10, flex:1, minWidth:0}}>
          <span style={{fontSize:18}}>🎫</span>
          <span style={{fontWeight:700, color:G.text, fontSize:14}}>
            Tichete deschise
          </span>
          {aleMele.length > 0 && (
            <span style={{
              padding:'2px 8px', borderRadius:10, background: accent + '33', color: accent,
              fontSize:11, fontWeight:800
            }}>
              🎯 {aleMele.length} {aleMele.length === 1 ? 'al tău' : 'ale tale'}
            </span>
          )}
          {disponibile.length > 0 && (
            <span style={{
              padding:'2px 8px', borderRadius:10, background: G.muted + '33', color: G.muted,
              fontSize:11, fontWeight:700
            }}>
              📥 {disponibile.length} disponibil{disponibile.length === 1 ? '' : 'e'}
            </span>
          )}
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <button onClick={(e) => { e.stopPropagation(); navigate('/tichete') }} style={{
            background:'transparent', border:`1px solid ${G.border2}`, color: G.muted,
            padding:'4px 10px', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:600
          }}>
            Vezi toate →
          </button>
          <span style={{color: G.muted, fontSize:13, transition:'transform .2s', display:'inline-block',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)'}}>
            ▼
          </span>
        </div>
      </div>

      {/* Body — listă tichete */}
      {!collapsed && (
        <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:6}}>
          {aleMele.map(t => (
            <RowTichet key={t.id} t={t} profile={profile} accent={accent} navigate={navigate} mode="mine" />
          ))}
          {aleMele.length > 0 && disponibile.length > 0 && (
            <div style={{
              borderTop:`1px dashed ${G.border2}`, marginTop:4, marginBottom:2, paddingTop:8,
              fontSize:11, color:G.dim, fontWeight:700, letterSpacing:0.5, textTransform:'uppercase'
            }}>
              📥 Disponibile pentru preluare
            </div>
          )}
          {disponibile.map(t => (
            <RowTichet
              key={t.id} t={t} profile={profile} accent={accent} navigate={navigate} mode="disponibil"
              onPreia={preia} preluareInProgres={preluareInProgres}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RowTichet({ t, profile, accent, navigate, mode, onPreia, preluareInProgres }) {
  const urg = URG_INFO[t.urgenta] || URG_INFO.normal
  const isMine = mode === 'mine'
  const isDisp = mode === 'disponibil'
  const isPreluareRunning = preluareInProgres === t.id

  return (
    <div onClick={() => navigate(`/tichete?id=${t.id}`)} style={{
      display:'flex', alignItems:'center', gap:10, padding:'8px 10px',
      background: isMine ? accent + '11' : G.bg,
      border:`1px solid ${isMine ? accent + '55' : G.border2}`,
      borderRadius:8, cursor:'pointer', transition:'all .15s',
      fontSize:13
    }}
    onMouseEnter={e => { e.currentTarget.style.background = isMine ? accent + '22' : G.surface }}
    onMouseLeave={e => { e.currentTarget.style.background = isMine ? accent + '11' : G.bg }}
    >
      <span style={{fontSize:16, flexShrink:0}}>{urg.emoji}</span>
      <span style={{color:G.dim, fontSize:11, fontFamily:'monospace', flexShrink:0}}>
        #{t.numar_tichet}
      </span>
      <span style={{
        flex:1, minWidth:0, color:G.text, fontWeight: isMine ? 600 : 500,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
      }}>
        {t.titlu}
        {t.entitate_descriere && (
          <span style={{color:G.muted, fontWeight:400, fontSize:12, marginLeft:8}}>
            · {t.entitate_descriere}
          </span>
        )}
      </span>
      <span style={{color:G.dim, fontSize:11, flexShrink:0}}>
        {fmtRelative(t.created_at || t.data_deschidere)}
      </span>
      {isDisp && (
        <button onClick={(e) => onPreia(e, t)} disabled={isPreluareRunning} style={{
          padding:'5px 12px', borderRadius:6, border:`1px solid ${G.green}88`,
          background: isPreluareRunning ? G.green + '22' : G.green + '33',
          color: G.green, cursor: isPreluareRunning ? 'wait' : 'pointer',
          fontSize:11, fontWeight:800, flexShrink:0, transition:'all .15s'
        }}>
          {isPreluareRunning ? '...' : '📥 Preia'}
        </button>
      )}
    </div>
  )
}
