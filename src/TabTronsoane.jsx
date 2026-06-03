// ════════════════════════════════════════════════════════════════
// TabTronsoane.jsx — Modul Execuție · Tab Tronsoane (Faza D)
// 02.06.2026 — Program activități pe tronson per proiect
//
// Features:
// - Selector proiect activ
// - KPI: total / în lucru / finalizate / % progres lungime
// - Tabel tronsoane cu status, UAT, județ, lungime, suduri plan/exec
// - Add / Edit / Delete tronson (CRUD complet)
// - Import rapid din CSV / paste (viitor)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636',
  yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7', teal:'#2DD4BF', executie:'#58A6FF',
}

const S = {
  input: {
    width:'100%', boxSizing:'border-box', background:G.bg,
    border:`1px solid ${G.border2}`, borderRadius:6,
    padding:'8px 12px', color:G.text, fontSize:13, outline:'none',
  },
  label: {
    display:'block', fontSize:11, color:G.muted, marginBottom:4,
    fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px',
  },
}

const STATUS_INFO = {
  neinceput:  { label:'Neînceput',  color:G.muted,   bg:G.border2,        icon:'○' },
  in_lucru:   { label:'În lucru',   color:G.blue,    bg:G.blue+'22',      icon:'◐' },
  finalizat:  { label:'Finalizat',  color:G.green,   bg:G.greenBg+'44',   icon:'✓' },
  suspendat:  { label:'Suspendat',  color:G.yellow,  bg:G.yellow+'22',    icon:'⏸' },
  blocat:     { label:'Blocat',     color:G.red,     bg:G.red+'22',       icon:'✕' },
}

const JUDETE = ['Vâlcea','Olt','Argeș','Dolj','Gorj','Prahova','Ilfov','Iași','Bacău','Vrancea','Galați','Brașov','Sibiu','Cluj','Timiș','Suceava','Neamț','Constanța','Tulcea','Mureș']

const fmtM = v => {
  if (!v && v !== 0) return '—'
  const n = parseFloat(v)
  return n >= 1000 ? `${(n/1000).toFixed(2)} km` : `${n} m`
}
const fmtDate = d => d ? new Date(d).toLocaleDateString('ro-RO', {day:'2-digit',month:'short',year:'numeric'}) : '—'

function useToast() {
  const [t, setT] = useState(null)
  const show = (msg, kind='ok') => { setT({msg,kind}); setTimeout(()=>setT(null),3500) }
  const Toast = () => t ? (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background:t.kind==='err'?G.red:G.greenBg, color:'#fff',
      borderRadius:8, fontWeight:600, fontSize:13, zIndex:10000,
      boxShadow:'0 8px 24px rgba(0,0,0,.4)',
    }}>{t.msg}</div>
  ) : null
  return { show, Toast }
}

// ══════════════════════════════════════════════════════════
// MODAL ADAUGARE / EDITARE TRONSON
// ══════════════════════════════════════════════════════════
function TronsonModal({ tronson, proiectId, onClose, onSaved, showToast }) {
  const isNew = !tronson?.id
  const [form, setForm] = useState({
    cod:               tronson?.cod || '',
    denumire:          tronson?.denumire || '',
    uat:               tronson?.uat || '',
    judet:             tronson?.judet || '',
    km_start_m:        tronson?.km_start_m || '',
    km_end_m:          tronson?.km_end_m || '',
    lungime_planificata_km: tronson?.lungime_planificata_km || '',
    nr_suduri_plan:    tronson?.nr_suduri_plan || '',
    nr_suduri_exec:    tronson?.nr_suduri_exec || 0,
    status:            tronson?.status || 'neinceput',
    data_start_real:   tronson?.data_start_real || '',
    data_final_real:   tronson?.data_final_real || '',
    tip_teren:         tronson?.tip_teren || 'camp',
    are_foraj:         tronson?.are_foraj || false,
    ordine:            tronson?.ordine || '',
    note:              tronson?.note || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({...f, [k]:v}))

  const handleSave = async () => {
    if (!form.cod.trim()) { showToast('Codul tronsonului este obligatoriu', 'err'); return }
    setSaving(true)
    try {
      const payload = {
        proiect_id:            proiectId,
        cod:                   form.cod.trim(),
        denumire:              form.denumire.trim() || null,
        uat:                   form.uat.trim() || null,
        judet:                 form.judet || null,
        km_start_m:            form.km_start_m !== '' ? parseInt(form.km_start_m) : null,
        km_end_m:              form.km_end_m   !== '' ? parseInt(form.km_end_m)   : null,
        lungime_planificata_km: form.lungime_planificata_km !== '' ? parseFloat(form.lungime_planificata_km) : null,
        nr_suduri_plan:        form.nr_suduri_plan !== '' ? parseInt(form.nr_suduri_plan) : null,
        nr_suduri_exec:        parseInt(form.nr_suduri_exec) || 0,
        status:                form.status,
        data_start_real:       form.data_start_real || null,
        data_final_real:       form.data_final_real || null,
        tip_teren:             form.tip_teren,
        are_foraj:             form.are_foraj,
        ordine:                form.ordine !== '' ? parseInt(form.ordine) : 0,
        note:                  form.note.trim() || null,
        updated_at:            new Date().toISOString(),
      }
      let error
      if (isNew) {
        const res = await supabase.from('executie_tronsoane').insert(payload)
        error = res.error
      } else {
        const res = await supabase.from('executie_tronsoane').update(payload).eq('id', tronson.id)
        error = res.error
      }
      if (error) throw error
      showToast(isNew ? 'Tronson adăugat!' : 'Tronson actualizat!', 'ok')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }} onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:640, maxHeight:'88vh', overflow:'auto',
      }}>
        {/* Header */}
        <div style={{padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:16, fontWeight:700}}>{isNew ? '＋ Tronson nou' : `✏️ Editează: ${tronson.cod}`}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        {/* Body */}
        <div style={{padding:'20px 24px', display:'flex', flexDirection:'column', gap:14}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:12}}>
            <div>
              <label style={S.label}>Cod tronson *</label>
              <input value={form.cod} onChange={e=>set('cod',e.target.value)} style={S.input} placeholder="ex: TR1, V-01" />
            </div>
            <div>
              <label style={S.label}>Denumire</label>
              <input value={form.denumire} onChange={e=>set('denumire',e.target.value)} style={S.input} placeholder="Descriere tronson" />
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>UAT (localitate)</label>
              <input value={form.uat} onChange={e=>set('uat',e.target.value)} style={S.input} placeholder="ex: Drăgășani, Corbu" />
            </div>
            <div>
              <label style={S.label}>Județ</label>
              <select value={form.judet} onChange={e=>set('judet',e.target.value)} style={S.input}>
                <option value="">— Selectează —</option>
                {JUDETE.map(j => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Km start (m)</label>
              <input type="number" value={form.km_start_m} onChange={e=>set('km_start_m',e.target.value)} style={S.input} placeholder="0" />
            </div>
            <div>
              <label style={S.label}>Km final (m)</label>
              <input type="number" value={form.km_end_m} onChange={e=>set('km_end_m',e.target.value)} style={S.input} placeholder="0" />
            </div>
            <div>
              <label style={S.label}>Lungime plan (km)</label>
              <input type="number" value={form.lungime_planificata_km} onChange={e=>set('lungime_planificata_km',e.target.value)} style={S.input} placeholder="0.00" step="0.001" />
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Suduri plan</label>
              <input type="number" value={form.nr_suduri_plan} onChange={e=>set('nr_suduri_plan',e.target.value)} style={S.input} placeholder="0" />
            </div>
            <div>
              <label style={S.label}>Suduri executate</label>
              <input type="number" value={form.nr_suduri_exec} onChange={e=>set('nr_suduri_exec',e.target.value)} style={S.input} placeholder="0" />
            </div>
            <div>
              <label style={S.label}>Ordine afișare</label>
              <input type="number" value={form.ordine} onChange={e=>set('ordine',e.target.value)} style={S.input} placeholder="1, 2, 3..." />
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Status</label>
              <select value={form.status} onChange={e=>set('status',e.target.value)} style={S.input}>
                {Object.entries(STATUS_INFO).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Tip teren</label>
              <select value={form.tip_teren} onChange={e=>set('tip_teren',e.target.value)} style={S.input}>
                <option value="camp">Câmp</option>
                <option value="drum">Drum</option>
                <option value="traversare">Traversare</option>
                <option value="zona_locuita">Zonă locuită</option>
                <option value="padure">Pădure</option>
              </select>
            </div>
            <div style={{display:'flex', alignItems:'flex-end'}}>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', paddingBottom:8}}>
                <input type="checkbox" checked={form.are_foraj} onChange={e=>set('are_foraj',e.target.checked)} style={{width:16,height:16}} />
                <span style={{fontSize:13, color:G.text, fontWeight:600}}>Are foraj dirijat</span>
              </label>
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Data start real</label>
              <input type="date" value={form.data_start_real} onChange={e=>set('data_start_real',e.target.value)} style={S.input} />
            </div>
            <div>
              <label style={S.label}>Data finalizare real</label>
              <input type="date" value={form.data_final_real} onChange={e=>set('data_final_real',e.target.value)} style={S.input} />
            </div>
          </div>

          <div>
            <label style={S.label}>Note</label>
            <textarea value={form.note} onChange={e=>set('note',e.target.value)}
              style={{...S.input, resize:'vertical', minHeight:60}}
              placeholder="Obstacole, condiții speciale, observații..." />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding:'14px 24px', borderTop:`1px solid ${G.border}`,
          display:'flex', gap:10, justifyContent:'flex-end', background:G.bg,
        }}>
          <button onClick={onClose} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, fontSize:13, cursor:'pointer'}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'9px 18px', background:saving?G.muted:G.executie, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:13, cursor:saving?'not-allowed':'pointer', fontWeight:700,
          }}>{saving ? 'Se salvează...' : isNew ? '＋ Adaugă tronson' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// proiectId: prop opțional — când vine din ProiectContextView (Executie.jsx)
//   nu mai afișăm selectorii, tab-ul e în contextul proiectului selectat.
//   Când lipsește, tab-ul funcționează standalone cu selector propriu.
// ══════════════════════════════════════════════════════════
export default function TabTronsoane({ proiectId: proiectIdProp }) {
  const [proiecte, setProiecte]     = useState([])
  const [proiectId, setProiectId]   = useState(proiectIdProp ? String(proiectIdProp) : '')
  const [tronsoane, setTronsoane]   = useState([])
  const [profile, setProfile]       = useState(null)
  const [loading, setLoading]       = useState(false)
  const [editItem, setEditItem]     = useState(null) // null=closed, {}=new, {id,...}=edit
  const [deleteConf, setDeleteConf] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterJudet, setFilterJudet]   = useState('all')
  const { show: showToast, Toast } = useToast()

  // Load profile + proiecte (doar în modul standalone, nu din context)
  useEffect(() => {
    const init = async () => {
      const { data:{user} } = await supabase.auth.getUser()
      if (user) {
        const { data:prof } = await supabase.from('profiles').select('id,is_owner,role').eq('id',user.id).single()
        setProfile(prof)
      }
      if (!proiectIdProp) {
        const { data } = await supabase.from('executie_proiecte').select('id,cod_intern,nume,activ').eq('activ',true).order('cod_intern')
        setProiecte(data || [])
        if (data?.length) setProiectId(String(data[0].id))
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync cu prop când proiectul se schimbă din context
  useEffect(() => {
    if (proiectIdProp) setProiectId(String(proiectIdProp))
  }, [proiectIdProp])

  const loadTronsoane = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('executie_tronsoane')
        .select('*')
        .eq('proiect_id', proiectId)
        .order('ordine').order('cod')
      if (error) throw error
      setTronsoane(data || [])
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTronsoane() }, [loadTronsoane])

  const isOwner = profile?.is_owner === true
  const canEdit = isOwner || ['superadmin','manager_santier'].includes(profile?.role)

  // KPI compute
  const kpi = useMemo(() => {
    const total     = tronsoane.length
    const finalizat = tronsoane.filter(t=>t.status==='finalizat').length
    const in_lucru  = tronsoane.filter(t=>t.status==='in_lucru').length
    const blocat    = tronsoane.filter(t=>t.status==='blocat').length
    const lungTot   = tronsoane.reduce((a,t)=>a+parseFloat(t.lungime_planificata_km||0),0)
    const lungFin   = tronsoane.filter(t=>t.status==='finalizat').reduce((a,t)=>a+parseFloat(t.lungime_planificata_km||0),0)
    const sudPlan   = tronsoane.reduce((a,t)=>a+(t.nr_suduri_plan||0),0)
    const sudExec   = tronsoane.reduce((a,t)=>a+(t.nr_suduri_exec||0),0)
    const pctLung   = lungTot>0 ? Math.round(lungFin/lungTot*100) : 0
    const pctSud    = sudPlan>0 ? Math.round(sudExec/sudPlan*100) : 0
    return { total, finalizat, in_lucru, blocat, lungTot, lungFin, sudPlan, sudExec, pctLung, pctSud }
  }, [tronsoane])

  // Filter
  const filtered = useMemo(() => {
    return tronsoane.filter(t => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false
      if (filterJudet  !== 'all' && t.judet  !== filterJudet)  return false
      return true
    })
  }, [tronsoane, filterStatus, filterJudet])

  const judeteDisponibile = useMemo(() => {
    return [...new Set(tronsoane.map(t=>t.judet).filter(Boolean))].sort()
  }, [tronsoane])

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase.from('executie_tronsoane').delete().eq('id', id)
      if (error) throw error
      showToast('Tronson șters', 'ok')
      loadTronsoane()
    } catch(e) {
      showToast('Eroare la ștergere: ' + e.message, 'err')
    } finally {
      setDeleteConf(null)
    }
  }

  const proiectCurent = proiecte.find(p=>String(p.id)===proiectId)

  return (
    <div style={{padding:'24px 28px', maxWidth:1400, margin:'0 auto'}}>
      <Toast />

      {/* ─── HEADER ─── */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16, flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800}}>📍 Tronsoane execuție</h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>Program pe tronsoane · Status · Suduri · Lungime</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
          {/* Selector proiect — ascuns când tab-ul e în context proiect */}
          {!proiectIdProp && (
            <select
              value={proiectId}
              onChange={e=>setProiectId(e.target.value)}
              style={{...S.input, width:300, background:G.surface}}
            >
              {proiecte.map(p=>(
                <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume.slice(0,50)}</option>
              ))}
            </select>
          )}
          {canEdit && (
            <button onClick={()=>setEditItem({})} style={{
              padding:'9px 16px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
              display:'flex', alignItems:'center', gap:6,
            }}>＋ Tronson</button>
          )}
        </div>
      </div>

      {/* ─── KPI ─── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px,1fr))', gap:12, marginBottom:24}}>
        {[
          {label:'Total tronsoane',  value:kpi.total,                     icon:'📏', color:G.executie},
          {label:'În lucru',         value:kpi.in_lucru,                  icon:'◐',  color:G.blue},
          {label:'Finalizate',       value:`${kpi.finalizat}/${kpi.total}`,icon:'✓',  color:G.green},
          {label:'Blocate',          value:kpi.blocat||'0',               icon:'✕',  color:kpi.blocat>0?G.red:G.muted},
          {label:'Progres lungime',  value:`${kpi.pctLung}%`,             icon:'📐', color:kpi.pctLung>=80?G.green:kpi.pctLung>=40?G.yellow:G.blue},
          {label:'Suduri executate', value:`${kpi.sudExec}/${kpi.sudPlan}`,icon:'🔥', color:G.orange},
        ].map((k,i)=>(
          <div key={i} style={{
            background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
            padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
          }}>
            <div style={{
              width:36, height:36, borderRadius:8,
              background:k.color+'22', display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:17, flexShrink:0, color:k.color,
            }}>{k.icon}</div>
            <div>
              <div style={{fontSize:18, fontWeight:800, color:k.color, lineHeight:1}}>{k.value}</div>
              <div style={{fontSize:11, color:G.muted, marginTop:3}}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar lungime */}
      {kpi.lungTot > 0 && (
        <div style={{marginBottom:24}}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:G.muted, marginBottom:6}}>
            <span>Progres lungime conductă</span>
            <span>{(kpi.lungFin).toFixed(2)} km / {(kpi.lungTot).toFixed(2)} km total</span>
          </div>
          <div style={{height:8, background:G.border2, borderRadius:4, overflow:'hidden'}}>
            <div style={{
              height:'100%', borderRadius:4, transition:'width .4s ease',
              width:`${kpi.pctLung}%`,
              background:kpi.pctLung>=80?G.green:kpi.pctLung>=40?G.yellow:G.blue,
            }}/>
          </div>
        </div>
      )}

      {/* ─── FILTRE ─── */}
      <div style={{display:'flex', gap:10, marginBottom:16, flexWrap:'wrap'}}>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
          style={{...S.input, width:180, background:G.surface}}>
          <option value="all">Toate statusurile</option>
          {Object.entries(STATUS_INFO).map(([k,v])=>(
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        {judeteDisponibile.length > 1 && (
          <select value={filterJudet} onChange={e=>setFilterJudet(e.target.value)}
            style={{...S.input, width:160, background:G.surface}}>
            <option value="all">Toate județele</option>
            {judeteDisponibile.map(j=><option key={j} value={j}>{j}</option>)}
          </select>
        )}
        <div style={{color:G.muted, fontSize:12, alignSelf:'center', marginLeft:'auto'}}>
          {filtered.length} din {tronsoane.length} tronsoane
        </div>
      </div>

      {/* ─── TABEL ─── */}
      {loading ? (
        <div style={{textAlign:'center', padding:'60px 0', color:G.muted}}>
          <div style={{fontSize:32, marginBottom:12}}>⏳</div>Se încarcă...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:12,
          padding:'60px 40px', textAlign:'center',
        }}>
          <div style={{fontSize:48, marginBottom:12, opacity:.4}}>📍</div>
          <div style={{fontSize:16, fontWeight:600, marginBottom:8}}>
            {tronsoane.length === 0 ? 'Niciun tronson definit' : 'Niciun rezultat pentru filtrele selectate'}
          </div>
          {canEdit && tronsoane.length === 0 && (
            <button onClick={()=>setEditItem({})} style={{
              marginTop:16, padding:'10px 20px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>＋ Adaugă primul tronson</button>
          )}
        </div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{background:G.surface, borderBottom:`1px solid ${G.border}`}}>
                {['Cod','Denumire / UAT','Județ','Km','Lungime','Suduri','Status','Teren','Start real','Final real',''].map((h,i)=>(
                  <th key={i} style={{
                    padding:'10px 12px', textAlign:'left', fontWeight:600,
                    color:G.muted, fontSize:11, textTransform:'uppercase',
                    letterSpacing:'.3px', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t,idx) => {
                const si = STATUS_INFO[t.status] || STATUS_INFO.neinceput
                const pctSud = t.nr_suduri_plan>0 ? Math.round((t.nr_suduri_exec||0)/t.nr_suduri_plan*100) : null
                return (
                  <tr key={t.id} style={{
                    borderBottom:`1px solid ${G.border2}`,
                    background: idx%2===0 ? 'transparent' : G.bg+'88',
                    transition:'background .1s',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=G.surface}
                    onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'transparent':G.bg+'88'}
                  >
                    <td style={{padding:'10px 12px', fontWeight:700, color:G.executie, whiteSpace:'nowrap'}}>{t.cod}</td>
                    <td style={{padding:'10px 12px'}}>
                      <div style={{fontWeight:600, color:G.text}}>{t.denumire || '—'}</div>
                      {t.uat && <div style={{fontSize:11, color:G.muted, marginTop:2}}>📍 {t.uat}</div>}
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, whiteSpace:'nowrap'}}>{t.judet || '—'}</td>
                    <td style={{padding:'10px 12px', color:G.dim, fontSize:12, whiteSpace:'nowrap'}}>
                      {t.km_start_m!=null && t.km_end_m!=null ? `${t.km_start_m}–${t.km_end_m}` : '—'}
                    </td>
                    <td style={{padding:'10px 12px', whiteSpace:'nowrap'}}>
                      {t.lungime_planificata_km ? (
                        <span style={{fontWeight:600, color:G.teal}}>{parseFloat(t.lungime_planificata_km).toFixed(3)} km</span>
                      ) : '—'}
                    </td>
                    <td style={{padding:'10px 12px', whiteSpace:'nowrap'}}>
                      {t.nr_suduri_plan ? (
                        <div>
                          <div style={{fontSize:12, fontWeight:600}}>{t.nr_suduri_exec||0} / {t.nr_suduri_plan}</div>
                          {pctSud!=null && (
                            <div style={{height:4, background:G.border2, borderRadius:2, marginTop:3, width:60, overflow:'hidden'}}>
                              <div style={{height:'100%', width:`${Math.min(pctSud,100)}%`, background:pctSud>=100?G.green:G.orange, borderRadius:2}}/>
                            </div>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{padding:'10px 12px'}}>
                      <span style={{
                        padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:600,
                        background:si.bg, color:si.color, whiteSpace:'nowrap',
                      }}>{si.icon} {si.label}</span>
                    </td>
                    <td style={{padding:'10px 12px', color:G.dim, fontSize:12, whiteSpace:'nowrap'}}>
                      {t.tip_teren||'—'}{t.are_foraj?' 🔩':''}
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, fontSize:12, whiteSpace:'nowrap'}}>{fmtDate(t.data_start_real)}</td>
                    <td style={{padding:'10px 12px', color:G.muted, fontSize:12, whiteSpace:'nowrap'}}>{fmtDate(t.data_final_real)}</td>
                    <td style={{padding:'10px 12px'}}>
                      {canEdit && (
                        <div style={{display:'flex', gap:6}}>
                          <button onClick={()=>setEditItem(t)} style={{
                            padding:'5px 10px', background:G.border2, border:'none',
                            borderRadius:6, color:G.muted, cursor:'pointer', fontSize:12,
                          }}>✏️</button>
                          <button onClick={()=>setDeleteConf(t)} style={{
                            padding:'5px 10px', background:G.red+'22', border:'none',
                            borderRadius:6, color:G.red, cursor:'pointer', fontSize:12,
                          }}>🗑</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── MODAL EDIT ─── */}
      {editItem !== null && (
        <TronsonModal
          tronson={editItem?.id ? editItem : null}
          proiectId={parseInt(proiectId)}
          onClose={()=>setEditItem(null)}
          onSaved={()=>{ setEditItem(null); loadTronsoane() }}
          showToast={showToast}
        />
      )}

      {/* ─── CONFIRM DELETE ─── */}
      {deleteConf && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:1020,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <div style={{
            background:G.surface, border:`1px solid ${G.red}`, borderRadius:12,
            padding:28, maxWidth:400, width:'90%', textAlign:'center',
          }}>
            <div style={{fontSize:32, marginBottom:12}}>🗑</div>
            <div style={{fontSize:16, fontWeight:700, marginBottom:8}}>Ștergi tronsonul <span style={{color:G.red}}>{deleteConf.cod}</span>?</div>
            <div style={{color:G.muted, fontSize:13, marginBottom:20}}>Acțiunea este ireversibilă.</div>
            <div style={{display:'flex', gap:10, justifyContent:'center'}}>
              <button onClick={()=>setDeleteConf(null)} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer'}}>Anulează</button>
              <button onClick={()=>handleDelete(deleteConf.id)} style={{padding:'9px 18px', background:G.red, border:'none', borderRadius:7, color:'#fff', fontWeight:700, cursor:'pointer'}}>Șterge definitiv</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
