// ============================================================
// ModulNoutati.jsx — „Noutăți modul" (08.09.2026)
//   - buton ℹ️ Noutăți în topbar, cu badge = câte anunțuri necitite are user-ul pe modulul curent
//   - banner-reminder sub topbar: apare dacă există anunț necitit, neexpirat, și au trecut ≥12 h
//     de la ultima afișare (per user, în BD → module_noutati_citiri.ultima_afisare)
//   - „Am citit" → citit_la = now (nu mai apare niciodată); „Mai târziu" → ultima_afisare = now (revine în 12 h)
//   - owner / admin* / superadmin pot publica anunțuri noi (formular în panou)
//   - tabele: module_noutati (modul, titlu, continut, expira_la default +14 zile, activ) + module_noutati_citiri
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922', purple:'#BC8CFF', orange:'#F0883E',
}
const H12 = 12 * 3600 * 1000
const MODUL_LABEL = {
  logistica:'Logistică', hr:'HR', administrativ:'Administrativ', tichete:'Tichete', consumabile:'Consumabile',
  executie:'Execuție', financiar:'Financiar', achizitii:'Achiziții', ofertare:'Ofertare', magazie:'Magazie',
  pontaj:'Pontaj', panou:'Panou', rapoarte:'Rapoarte', salarii:'Salarii', admin:'Admin',
}
const fmtDT = (d) => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'

// continut simplu: paragrafe separate prin linie goală, liniile cu "- " devin bullet-uri
function Continut({ text }) {
  const blocks = String(text || '').split(/\n\s*\n/)
  return blocks.map((b, i) => {
    const lines = b.split('\n')
    if (lines.every(l => /^\s*[-•]\s/.test(l))) {
      return <ul key={i} style={{ margin:'6px 0 6px 18px', padding:0 }}>{lines.map((l, j) => <li key={j} style={{ marginBottom:3 }}>{l.replace(/^\s*[-•]\s/, '')}</li>)}</ul>
    }
    return <p key={i} style={{ margin:'6px 0', whiteSpace:'pre-wrap' }}>{b}</p>
  })
}

export default function ModulNoutati({ modul, profile }) {
  const uid = profile?.id
  const canPublish = profile?.is_owner === true || /^admin/i.test(profile?.role || '') || profile?.role === 'superadmin'
  const [items, setItems] = useState([])        // noutăți active pe modul (cu .citire atașată)
  const [open, setOpen] = useState(false)       // panoul cu lista
  const [banner, setBanner] = useState(null)    // noutatea afișată ca reminder
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ titlu:'', continut:'', zile:14 })
  const [saving, setSaving] = useState(false)
  const btnRef = useRef(null)

  const load = useCallback(async () => {
    if (!modul || !uid) { setItems([]); setBanner(null); return }
    const nowIso = new Date().toISOString()
    const { data: nout } = await supabase.from('module_noutati')
      .select('id, modul, titlu, continut, publicat_la, expira_la, activ')
      .eq('modul', modul).eq('activ', true).gt('expira_la', nowIso)
      .order('publicat_la', { ascending:false })
    const list = nout || []
    let citiri = []
    if (list.length) {
      const r = await supabase.from('module_noutati_citiri').select('noutate_id, ultima_afisare, citit_la')
        .eq('user_id', uid).in('noutate_id', list.map(n => n.id))
      citiri = r.data || []
    }
    const byId = Object.fromEntries(citiri.map(c => [c.noutate_id, c]))
    const merged = list.map(n => ({ ...n, citire: byId[n.id] || null }))
    setItems(merged)
    // reminder: primul necitit la care n-a fost afișat niciodată sau au trecut ≥12 h
    const cand = merged.find(n => !n.citire?.citit_la && (!n.citire?.ultima_afisare || Date.now() - new Date(n.citire.ultima_afisare).getTime() >= H12))
    setBanner(cand || null)
  }, [modul, uid])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (!open) setShowForm(false) }, [open])

  const marcheaza = async (n, citit) => {
    if (!uid) return
    const nowIso = new Date().toISOString()
    const row = { noutate_id: n.id, user_id: uid, ultima_afisare: nowIso, ...(citit ? { citit_la: nowIso } : {}) }
    await supabase.from('module_noutati_citiri').upsert(row, { onConflict:'noutate_id,user_id' })
    setItems(prev => prev.map(x => x.id === n.id ? { ...x, citire: { ...(x.citire || {}), ...row } } : x))
    if (banner?.id === n.id) setBanner(null)
  }
  // ultima_afisare se scrie și la simpla afișare a bannerului (ca să nu apară la fiecare refresh)
  useEffect(() => {
    if (!banner || !uid) return
    const cit = banner.citire
    if (cit?.ultima_afisare && Date.now() - new Date(cit.ultima_afisare).getTime() < H12) return
    supabase.from('module_noutati_citiri').upsert({ noutate_id: banner.id, user_id: uid, ultima_afisare: new Date().toISOString() }, { onConflict:'noutate_id,user_id' })
      .then(() => {})
  }, [banner?.id, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const publica = async () => {
    if (!form.titlu.trim() || !form.continut.trim()) return
    setSaving(true)
    const expira = new Date(Date.now() + Math.max(1, Number(form.zile) || 14) * 86400000).toISOString()
    const { error } = await supabase.from('module_noutati').insert({ modul, titlu: form.titlu.trim(), continut: form.continut.trim(), publicat_de: uid, expira_la: expira })
    setSaving(false)
    if (error) { alert('Eroare la publicare: ' + error.message); return }
    setForm({ titlu:'', continut:'', zile:14 }); setShowForm(false); load()
  }
  const dezactiveaza = async (n) => {
    if (!confirm(`Retragi anunțul „${n.titlu}"?`)) return
    await supabase.from('module_noutati').update({ activ:false }).eq('id', n.id)
    load()
  }

  // închidere panou la click în afară
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (!modul || !uid) return null
  const necitite = items.filter(n => !n.citire?.citit_la).length
  const label = MODUL_LABEL[modul] || modul
  const are = items.length > 0
  if (!are && !canPublish) return null

  return (
    <>
      <div ref={btnRef} style={{ position:'relative' }}>
        <button onClick={() => setOpen(v => !v)} title={`Noutăți în modulul ${label}`}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
            background: necitite > 0 ? G.blue+'22' : G.bg, color: necitite > 0 ? G.blue : G.dim, border:`1px solid ${necitite > 0 ? G.blue : G.border}` }}>
          ℹ️ Noutăți
          {necitite > 0 && <span style={{ background:G.blue, color:'#fff', borderRadius:10, padding:'1px 6px', fontSize:10, fontWeight:800 }}>{necitite}</span>}
        </button>
        {open && (
          <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:440, maxWidth:'92vw', maxHeight:'75vh', overflowY:'auto', zIndex:200,
            background:G.surface, border:`1px solid ${G.border}`, borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,.45)' }}>
            <div style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' }}>ℹ️ Noutăți · {label}</span>
              {canPublish && <button onClick={() => setShowForm(v => !v)} style={{ marginLeft:'auto', background:'#1F6FEB', color:'#fff', border:'none', borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>{showForm ? '✕ Renunță' : '+ Anunț nou'}</button>}
            </div>
            {showForm && (
              <div style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, display:'flex', flexDirection:'column', gap:6 }}>
                <input value={form.titlu} onChange={e => setForm(f => ({ ...f, titlu:e.target.value }))} placeholder="Titlu (ex. Taloane + poze piese în Service)"
                  style={{ background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'7px 10px', fontFamily:'inherit', fontSize:13, outline:'none' }} />
                <textarea value={form.continut} onChange={e => setForm(f => ({ ...f, continut:e.target.value }))} rows={7} placeholder={'Conținut. Paragrafe separate prin linie goală; liniile care încep cu "- " devin listă.'}
                  style={{ background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'7px 10px', fontFamily:'inherit', fontSize:13, outline:'none', resize:'vertical' }} />
                <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:G.muted }}>
                  Se reamintește la 12 h, timp de
                  <input type="number" min={1} max={60} value={form.zile} onChange={e => setForm(f => ({ ...f, zile:e.target.value }))}
                    style={{ width:52, background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:6, padding:'4px 6px', fontFamily:'inherit', fontSize:12 }} /> zile
                  <button disabled={saving} onClick={publica} style={{ marginLeft:'auto', background:G.green, color:'#fff', border:'none', borderRadius:7, padding:'6px 12px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', opacity: saving ? .6 : 1 }}>📣 Publică</button>
                </div>
              </div>
            )}
            {!are && <div style={{ padding:'18px 14px', fontSize:12, color:G.dim, textAlign:'center' }}>Nicio noutate activă pe acest modul.</div>}
            {items.map(n => {
              const citit = !!n.citire?.citit_la
              return (
                <div key={n.id} style={{ padding:'10px 14px', borderBottom:`1px solid ${G.border}`, background: citit ? 'transparent' : G.blue+'0D' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color: citit ? G.text : G.blue }}>{citit ? '' : '● '}{n.titlu}</div>
                      <div style={{ fontSize:10, color:G.dim, marginTop:2 }}>publicat {fmtDT(n.publicat_la)} · valabil până {fmtDT(n.expira_la)}{citit ? ` · citit ${fmtDT(n.citire.citit_la)}` : ''}</div>
                    </div>
                    {canPublish && <button onClick={() => dezactiveaza(n)} title="Retrage anunțul" style={{ background:'transparent', border:'none', color:G.dim, cursor:'pointer', fontSize:12 }}>🗑</button>}
                  </div>
                  <div style={{ fontSize:12, color:G.text, lineHeight:1.45, marginTop:4 }}><Continut text={n.continut} /></div>
                  {!citit && <button onClick={() => marcheaza(n, true)} style={{ marginTop:6, background:G.green+'22', color:G.green, border:`1px solid ${G.green}55`, borderRadius:7, padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>✓ Am citit</button>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Banner reminder — o dată la 12 h până la „Am citit" sau expirare */}
      {banner && (
        <div style={{ position:'fixed', right:18, bottom:18, width:460, maxWidth:'92vw', zIndex:250, background:G.surface, border:`1px solid ${G.blue}66`, borderLeft:`4px solid ${G.blue}`,
          borderRadius:12, boxShadow:'0 12px 40px rgba(0,0,0,.5)', padding:'14px 16px' }}>
          <div style={{ fontSize:11, color:G.blue, fontWeight:800, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>ℹ️ Noutate în modulul {label}</div>
          <div style={{ fontSize:14, fontWeight:700, color:G.text }}>{banner.titlu}</div>
          <div style={{ fontSize:12, color:G.text, lineHeight:1.45, marginTop:6, maxHeight:260, overflowY:'auto' }}><Continut text={banner.continut} /></div>
          <div style={{ display:'flex', gap:8, marginTop:10 }}>
            <button onClick={() => marcheaza(banner, true)} style={{ background:G.green, color:'#fff', border:'none', borderRadius:8, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>✓ Am citit</button>
            <button onClick={() => marcheaza(banner, false)} style={{ background:'transparent', color:G.muted, border:`1px solid ${G.border2}`, borderRadius:8, padding:'7px 14px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Mai târziu (revine în 12 h)</button>
          </div>
        </div>
      )}
    </>
  )
}
