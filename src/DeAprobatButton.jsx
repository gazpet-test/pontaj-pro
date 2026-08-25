// ════════════════════════════════════════════════════════════════════════════
// DE APROBAT — buton global navbar (12.06.2026)
// Agregator per-user al lucrurilor care AȘTEAPTĂ APROBAREA LUI:
//   🛒 Comenzi furnizor (comenzi_furnizor_aprobari, rândul propriu in_asteptare)
//   🚚 Comenzi transport (logistica_comenzi_transport: submitata → Mitrache,
//      aprobata_mitrache → Pușcașu; owner-ii văd ambele)
// Tichetele rămân în sistemul lor separat (decizie Razvan 12.06.2026).
// Aprobările de comenzi NU mai merg în clopoțel — acest buton le preia.
// Extensibil: orice flux nou de aprobare se adaugă aici ca secțiune.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
// Bara de sus taie pe verticală (overflow-x:auto pt. swipe) — meniul se randează
// prin portal, altfel se deschide invizibil. Vezi PopoverBara.jsx.
import PopoverBara from './PopoverBara.jsx'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', red:'#F85149', yellow:'#D29922', blue:'#58A6FF',
}
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const fmtNr = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }

export default function DeAprobatButton({ profile }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [comenzi, setComenzi] = useState([])
  const [transporturi, setTransporturi] = useState([])

  const isOwner = profile?.is_owner === true
  const numeN = norm(profile?.name)
  const eMitrache = numeN.includes('mitrache')
  const ePuscasu = numeN.includes('puscasu')

  const load = useCallback(async () => {
    if (!profile?.id) return
    try {
      // 1. Comenzi furnizor — rândul MEU de aprobare în așteptare
      const { data: apr } = await supabase.from('comenzi_furnizor_aprobari')
        .select('id, comanda:comenzi_furnizor(id, numar_comanda, moneda, status, linii:comenzi_furnizor_linii(cantitate, pret_unitar))')
        .eq('profile_id', profile.id).eq('status', 'in_asteptare')
      setComenzi((apr || []).filter(a => a.comanda?.status === 'in_aprobare'))

      // 2. Comenzi transport — în funcție de pasul de aprobare al user-ului
      const statusuri = []
      if (eMitrache || isOwner) statusuri.push('submitata')
      if (ePuscasu || isOwner) statusuri.push('aprobata_mitrache')
      if (statusuri.length) {
        const { data: tr } = await supabase.from('logistica_comenzi_transport')
          .select('id, numar_comanda, data_transport, tip_transport, status')
          .in('status', statusuri).order('data_transport')
        setTransporturi(tr || [])
      } else setTransporturi([])
    } catch (e) { console.error('DeAprobat load:', e) }
  }, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  const total = comenzi.length + transporturi.length
  const totalComanda = (c) => (c?.linii || []).reduce((a, l) => a + (Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0), 0)

  return (
    <div style={{ position:'relative' }}>
      <style>{`@keyframes deAprobatPulse{0%,100%{box-shadow:0 0 0 0 rgba(63,185,80,.45)}50%{box-shadow:0 0 0 6px rgba(63,185,80,0)}}`}</style>
      <button
        ref={btnRef}
        onClick={() => { setOpen(v => !v); if (!open) load() }}
        title="Tot ce așteaptă aprobarea ta — comenzi furnizor, transporturi"
        style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'7px 14px',
          background: total > 0 ? G.green + '22' : G.bg,
          color: total > 0 ? G.green : G.dim,
          border: `1px solid ${total > 0 ? G.green + '88' : G.border}`,
          borderRadius: 8, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', transition: 'all .15s', fontFamily: 'inherit',
          animation: total > 0 ? 'deAprobatPulse 2s infinite' : 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = G.green + '33'; e.currentTarget.style.color = G.green; e.currentTarget.style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { e.currentTarget.style.background = total > 0 ? G.green + '22' : G.bg; e.currentTarget.style.color = total > 0 ? G.green : G.dim; e.currentTarget.style.transform = 'translateY(0)' }}
      >
        ✅ De aprobat
        {total > 0 && (
          <span style={{ background:G.red, color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:11, fontWeight:800 }}>{total}</span>
        )}
        <span style={{ fontSize:9, opacity:.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <PopoverBara anchorRef={btnRef} onClose={() => setOpen(false)} width={360}>
          <div style={{
            background:G.surface, border:`1px solid ${G.border}`, borderRadius:12,
            boxShadow:'0 8px 32px rgba(0,0,0,.4)', overflow:'hidden',
          }}>
            <div style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' }}>
              ✅ Așteaptă aprobarea ta
            </div>

            {total === 0 && (
              <div style={{ padding:'22px 14px', textAlign:'center', fontSize:13, color:G.dim }}>
                🎉 Nimic de aprobat — ești la zi.
              </div>
            )}

            {comenzi.length > 0 && (
              <div>
                <div style={{ padding:'8px 14px 4px', fontSize:11, color:G.green, fontWeight:800 }}>🛒 COMENZI FURNIZOR ({comenzi.length})</div>
                {comenzi.map(a => (
                  <button key={a.id} onClick={() => { nav(`/achizitii?id=${a.comanda.id}`); setOpen(false) }}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', background:'transparent', border:'none', cursor:'pointer', borderBottom:`1px solid ${G.border}`, fontFamily:'inherit', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = G.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width:34, height:34, borderRadius:8, background:G.green + '22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🛒</div>
                    <div style={{ textAlign:'left', flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:G.text }}>{a.comanda.numar_comanda}</div>
                      <div style={{ fontSize:11, color:G.muted }}>{fmtNr(totalComanda(a.comanda))} {a.comanda.moneda}</div>
                    </div>
                    <div style={{ fontSize:11, color:G.green, fontWeight:700 }}>Decide →</div>
                  </button>
                ))}
              </div>
            )}

            {transporturi.length > 0 && (
              <div>
                <div style={{ padding:'8px 14px 4px', fontSize:11, color:G.yellow, fontWeight:800 }}>🚚 COMENZI TRANSPORT ({transporturi.length})</div>
                {transporturi.map(t => (
                  <button key={t.id} onClick={() => { nav('/logistica?tab=transporturi'); setOpen(false) }}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', background:'transparent', border:'none', cursor:'pointer', borderBottom:`1px solid ${G.border}`, fontFamily:'inherit', transition:'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = G.bg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width:34, height:34, borderRadius:8, background:G.yellow + '22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🚚</div>
                    <div style={{ textAlign:'left', flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:G.text }}>{t.numar_comanda || `Transport #${t.id}`}</div>
                      <div style={{ fontSize:11, color:G.muted }}>{fmtData(t.data_transport)} · {t.status === 'submitata' ? 'pas 1 — Mitrache' : 'pas 2 — Pușcașu'}</div>
                    </div>
                    <div style={{ fontSize:11, color:G.yellow, fontWeight:700 }}>Decide →</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </PopoverBara>
      )}
    </div>
  )
}
