// ════════════════════════════════════════════════════════════════
// TabSantiere.jsx — Modul Execuție · Tab Șantiere
// 02.06.2026 — Faza B: Alocare personal pe tură
//
// Features:
// - Selector proiect + fereastră tură (data_start/end custom)
// - Adaugă/editează/șterge personal alocat (meserie + echipă + navetă)
// - KPI breakdown pe meserie (Deservenți/Sudori/Lăcătuși/etc.)
// - Plan vs Realizat: badge verde dacă există pontaj în fereastra turei
// - Căutare angajat cu autocomplete din employees activi
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922',
  orange:'#F0883E', red:'#F85149', purple:'#A371F7', executie:'#58A6FF',
}

const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  btn:   { padding:'8px 16px', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  lbl:   { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
}

const MESERII = [
  { key:'deservent_utilaje', label:'Deservent utilaje',   icon:'🚜', color:'#F0883E' },
  { key:'sudor',             label:'Sudor',               icon:'🔥', color:'#F85149' },
  { key:'lacatus_mecanic',   label:'Lăcătuș mecanic',     icon:'🔧', color:'#58A6FF' },
  { key:'muncitor_izolator', label:'Muncitor / Izolator', icon:'👷', color:'#2EA043' },
  { key:'tesa_paza',         label:'TESA / Pază',         icon:'🛡️', color:'#A371F7' },
  { key:'sofer',             label:'Șofer',               icon:'🚗', color:'#D29922' },
  { key:'alt',               label:'Alt',                 icon:'👤', color:'#8B949E' },
]
const getMeserie = k => MESERII.find(m => m.key === k) || MESERII[MESERII.length - 1]

const fmtDate = s => s ? new Date(s).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const fmtDateShort = s => s ? new Date(s).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit' }) : '—'

function useToast() {
  const [t, setT] = useState(null)
  const show = (msg, kind='ok') => { setT({msg,kind}); setTimeout(()=>setT(null),3500) }
  const Toast = () => t ? (
    <div style={{position:'fixed',bottom:24,right:24,padding:'12px 18px',
      background:t.kind==='err'?G.red:G.greenBg,color:'#fff',borderRadius:8,
      fontWeight:600,fontSize:13,zIndex:10000,boxShadow:'0 8px 24px rgba(0,0,0,.4)'}}>
      {t.msg}
    </div>
  ) : null
  return { show, Toast }
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function TabSantiere() {
  const [proiecte, setProiecte] = useState([])
  const [employees, setEmployees] = useState([])
  const [alocari, setAlocari] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Filtre
  const [proiectId, setProiectId] = useState('')
  const [dataStart, setDataStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0,10)
  })
  const [dataEnd, setDataEnd] = useState(() => {
    const d = new Date(); d.setDate(14); return d.toISOString().slice(0,10)
  })
  const [filterMeserie, setFilterMeserie] = useState('all')
  const [searchEmp, setSearchEmp] = useState('')

  const [editAlocare, setEditAlocare] = useState(null)
  const { show, Toast } = useToast()

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role').eq('id',user.id).single()
        setProfile(prof)
      }
      const [pRes, eRes] = await Promise.all([
        supabase.from('executie_proiecte').select('id,cod_intern,nume,activ,site_id').eq('activ',true).order('cod_intern'),
        supabase.from('employees').select('id,name,functie,department').eq('active',true).order('name'),
      ])
      setProiecte(pRes.data || [])
      setEmployees(eRes.data || [])
      if (!proiectId && pRes.data?.length > 0) setProiectId(String(pRes.data[0].id))
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAlocari = useCallback(async () => {
    if (!proiectId) return
    const { data, error } = await supabase
      .from('v_executie_alocari')
      .select('*')
      .eq('proiect_id', proiectId)
      .gte('data_start', dataStart)
      .lte('data_end', dataEnd)
      .order('data_start')
    if (!error) setAlocari(data || [])
  }, [proiectId, dataStart, dataEnd])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { loadAlocari() }, [loadAlocari])

  const canWrite = profile?.is_owner || ['superadmin','manager_santier'].includes(profile?.role)
  const isOwner  = profile?.is_owner === true

  // Site-ul proiectului selectat
  const currentSiteId = useMemo(() => {
    const p = proiecte.find(p => String(p.id) === String(proiectId))
    return p?.site_id || null
  }, [proiecte, proiectId])

  // KPI pe meserie
  const kpiMeserie = useMemo(() => {
    const counts = {}
    MESERII.forEach(m => counts[m.key] = 0)
    alocari.forEach(a => { if (a.meserie) counts[a.meserie] = (counts[a.meserie]||0) + 1 })
    return counts
  }, [alocari])

  const totalAlocati = alocari.length
  const cuPontaj = alocari.filter(a => a.are_pontaj_realizat).length

  // Filtrare locală
  const filtered = useMemo(() => {
    let list = alocari
    if (filterMeserie !== 'all') list = list.filter(a => a.meserie === filterMeserie)
    if (searchEmp.trim()) {
      const s = searchEmp.toLowerCase()
      list = list.filter(a => (a.employee_name||'').toLowerCase().includes(s) || (a.echipa||'').toLowerCase().includes(s))
    }
    return list
  }, [alocari, filterMeserie, searchEmp])

  const handleDelete = async a => {
    if (!confirm(`Șterge alocarea lui ${a.employee_name}?`)) return
    const { error } = await supabase.from('executie_alocari_personal').delete().eq('id', a.id)
    if (error) show('Eroare: ' + error.message, 'err')
    else { show('✓ Alocare ștearsă'); loadAlocari() }
  }

  if (loading) return (
    <div style={{padding:60, textAlign:'center', color:G.muted}}>⏳ Se încarcă...</div>
  )

  return (
    <div style={{padding:'24px 28px', maxWidth:1400, margin:'0 auto'}}>
      {/* ─── HEADER ─── */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800, color:G.text}}>🏗️ Alocare personal pe tură</h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>Plan tură · Meserii · Echipe · Plan vs Realizat</div>
        </div>
        {canWrite && (
          <button
            onClick={() => setEditAlocare({ proiect_id: proiectId, data_start: dataStart, data_end: dataEnd })}
            style={{...S.btn, background:G.executie, color:'#0D1117', display:'flex', alignItems:'center', gap:8}}
          >＋ Adaugă persoană</button>
        )}
      </div>

      {/* ─── FILTRE TURĂ ─── */}
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
        padding:'16px 20px', marginBottom:20,
        display:'grid', gridTemplateColumns:'2fr 1fr 1fr auto', gap:14, alignItems:'end'
      }}>
        <div>
          <label style={S.lbl}>Proiect</label>
          <select value={proiectId} onChange={e => setProiectId(e.target.value)} style={S.input}>
            {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume.slice(0,50)}</option>)}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Start tură</label>
          <input type="date" value={dataStart} onChange={e => setDataStart(e.target.value)} style={S.input} />
        </div>
        <div>
          <label style={S.lbl}>End tură</label>
          <input type="date" value={dataEnd} onChange={e => setDataEnd(e.target.value)} style={S.input} />
        </div>
        <div style={{paddingBottom:1}}>
          <div style={{fontSize:11, color:G.muted, marginBottom:4}}>
            {dataStart && dataEnd ? `${Math.max(0, Math.round((new Date(dataEnd)-new Date(dataStart))/(1000*60*60*24))+1)} zile` : ''}
          </div>
          <button onClick={loadAlocari} style={{...S.btn, background:G.executie, color:'#0D1117', padding:'9px 16px'}}>
            🔄 Actualizează
          </button>
        </div>
      </div>

      {/* ─── KPI MESERII ─── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px,1fr))', gap:10, marginBottom:20}}>
        {/* Total */}
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
          padding:'12px 16px', gridColumn:'span 1'
        }}>
          <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4}}>Total alocat</div>
          <div style={{fontSize:26, fontWeight:800, color:G.executie}}>{totalAlocati}</div>
          <div style={{fontSize:10, color:G.muted, marginTop:2}}>
            {cuPontaj > 0 && <span style={{color:G.green}}>✓ {cuPontaj} cu pontaj</span>}
          </div>
        </div>
        {/* Per meserie */}
        {MESERII.filter(m => kpiMeserie[m.key] > 0 || m.key !== 'alt').slice(0,6).map(m => (
          <div key={m.key} style={{
            background:G.surface, border:`1px solid ${kpiMeserie[m.key]>0 ? m.color+'44' : G.border}`,
            borderRadius:10, padding:'12px 16px',
            cursor:'pointer', transition:'all .1s',
            opacity: kpiMeserie[m.key] === 0 ? 0.4 : 1,
          }}
            onClick={() => setFilterMeserie(filterMeserie === m.key ? 'all' : m.key)}
          >
            <div style={{fontSize:16, marginBottom:4}}>{m.icon}</div>
            <div style={{fontSize:22, fontWeight:800, color: kpiMeserie[m.key]>0 ? m.color : G.dim}}>
              {kpiMeserie[m.key]}
            </div>
            <div style={{fontSize:10, color:G.muted, marginTop:2, lineHeight:1.2}}>{m.label}</div>
            {filterMeserie === m.key && (
              <div style={{fontSize:9, color:m.color, marginTop:3, fontWeight:700}}>▼ filtrat</div>
            )}
          </div>
        ))}
      </div>

      {/* ─── CĂUTARE + FILTRU ─── */}
      <div style={{display:'flex', gap:10, marginBottom:14, flexWrap:'wrap'}}>
        <input
          placeholder="🔍 Caută angajat sau echipă..."
          value={searchEmp} onChange={e => setSearchEmp(e.target.value)}
          style={{...S.input, flex:1, minWidth:200, maxWidth:320}}
        />
        {filterMeserie !== 'all' && (
          <button onClick={() => setFilterMeserie('all')}
            style={{...S.btn, background:G.border2, color:G.muted, padding:'6px 12px', fontSize:12}}>
            ✕ Șterge filtru meserie
          </button>
        )}
        <div style={{fontSize:12, color:G.muted, display:'flex', alignItems:'center', gap:6}}>
          <span style={{width:10,height:10,borderRadius:'50%',background:G.green,display:'inline-block'}} />
          cu pontaj
          <span style={{width:10,height:10,borderRadius:'50%',background:G.border,display:'inline-block',marginLeft:8}} />
          fără pontaj
        </div>
      </div>

      {/* ─── LISTA ALOCĂRI ─── */}
      {filtered.length === 0 ? (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
          padding:'50px 40px', textAlign:'center', color:G.muted
        }}>
          <div style={{fontSize:40, marginBottom:12}}>👷</div>
          <div style={{fontSize:15, fontWeight:600, marginBottom:6}}>
            {alocari.length === 0 ? 'Nicio persoană alocată în această tură' : 'Niciun rezultat pentru filtrele alese'}
          </div>
          {alocari.length === 0 && canWrite && (
            <div style={{fontSize:13}}>Apasă „＋ Adaugă persoană" pentru a aloca primul angajat.</div>
          )}
        </div>
      ) : (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`,
          borderRadius:10, overflow:'hidden'
        }}>
          {/* Header tabel */}
          <div style={{
            display:'grid', gridTemplateColumns:'auto 1fr 120px 140px 120px 100px auto',
            padding:'10px 16px', background:G.bg,
            borderBottom:`1px solid ${G.border}`,
            fontSize:10, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.4px'
          }}>
            <div style={{width:28}} />
            <div>Angajat</div>
            <div>Meserie</div>
            <div>Echipă</div>
            <div>Perioadă</div>
            <div>Pontaj</div>
            <div />
          </div>
          {filtered.map((a, i) => {
            const m = getMeserie(a.meserie)
            return (
              <div key={a.id} style={{
                display:'grid', gridTemplateColumns:'auto 1fr 120px 140px 120px 100px auto',
                padding:'11px 16px', alignItems:'center',
                borderBottom: i < filtered.length-1 ? `1px solid ${G.border}` : 'none',
                background: i % 2 === 0 ? 'transparent' : G.bg+'44',
              }}>
                {/* Meserie icon */}
                <div style={{
                  width:28, height:28, borderRadius:7,
                  background: m.color + '22', display:'flex', alignItems:'center',
                  justifyContent:'center', fontSize:14, marginRight:4
                }} title={m.label}>{m.icon}</div>

                {/* Angajat */}
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:700, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    {a.employee_name}
                  </div>
                  <div style={{fontSize:10, color:G.muted}}>
                    {a.employee_functie}
                    {a.masina_naveta && <span style={{marginLeft:8}}>🚗 {a.masina_naveta}</span>}
                  </div>
                </div>

                {/* Meserie label */}
                <div>
                  <span style={{
                    padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700,
                    background: m.color+'22', color: m.color
                  }}>{m.label}</span>
                </div>

                {/* Echipă */}
                <div style={{fontSize:12, color:G.muted}}>
                  {a.echipa || <span style={{color:G.dim, fontStyle:'italic'}}>—</span>}
                </div>

                {/* Perioadă */}
                <div style={{fontSize:11, color:G.muted}}>
                  {fmtDateShort(a.data_start)} → {fmtDateShort(a.data_end)}
                  <div style={{fontSize:10, color:G.dim}}>{a.nr_zile_tura} zile</div>
                </div>

                {/* Pontaj realizat */}
                <div>
                  {a.are_pontaj_realizat ? (
                    <span style={{
                      padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700,
                      background:G.green+'22', color:G.green
                    }}>✓ Realizat</span>
                  ) : (
                    <span style={{
                      padding:'2px 8px', borderRadius:10, fontSize:10,
                      background:G.border, color:G.dim
                    }}>— Plan</span>
                  )}
                </div>

                {/* Acțiuni */}
                <div style={{display:'flex', gap:4}}>
                  {canWrite && (
                    <button onClick={() => setEditAlocare(a)}
                      style={{...S.btn, padding:'4px 8px', fontSize:11, background:G.card2, color:G.muted, border:`1px solid ${G.border}`}}>
                      ✏️
                    </button>
                  )}
                  {(isOwner || profile?.role === 'manager_santier') && (
                    <button onClick={() => handleDelete(a)}
                      style={{...S.btn, padding:'4px 8px', fontSize:11, background:G.red+'22', color:G.red, border:`1px solid ${G.red}44`}}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Footer total */}
          <div style={{
            padding:'10px 16px', background:G.bg,
            borderTop:`1px solid ${G.border}`,
            display:'flex', alignItems:'center', justifyContent:'space-between',
            fontSize:11, color:G.muted
          }}>
            <span><strong style={{color:G.text}}>{filtered.length}</strong> persoane afișate</span>
            <span>
              <span style={{color:G.green, fontWeight:700}}>{alocari.filter(a=>a.are_pontaj_realizat).length}</span> cu pontaj realizat ·{' '}
              <span style={{color:G.yellow, fontWeight:700}}>{alocari.filter(a=>!a.are_pontaj_realizat).length}</span> doar plan
            </span>
          </div>
        </div>
      )}

      {/* ─── MODAL ALOCARE ─── */}
      {editAlocare && (
        <AlocareModal
          item={editAlocare}
          proiecte={proiecte}
          employees={employees}
          defaultProiectId={proiectId}
          defaultStart={dataStart}
          defaultEnd={dataEnd}
          onClose={() => setEditAlocare(null)}
          onSaved={() => { setEditAlocare(null); loadAlocari(); show('✓ Alocare salvată') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}

      {/* ─── UTILAJE PE TURĂ ─── */}
      <UtilajeTura
        proiectId={proiectId}
        proiecte={proiecte}
        siteId={currentSiteId}
        dataStart={dataStart}
        dataEnd={dataEnd}
        canWrite={canWrite}
        isOwner={isOwner}
      />

      <Toast />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ADD/EDIT ALOCARE
// ══════════════════════════════════════════════════════════
function AlocareModal({ item, proiecte, employees, defaultProiectId, defaultStart, defaultEnd, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    proiect_id:  item.proiect_id  || defaultProiectId || '',
    employee_id: item.employee_id || '',
    meserie:     item.meserie     || 'muncitor_izolator',
    echipa:      item.echipa      || '',
    data_start:  item.data_start  || defaultStart || '',
    data_end:    item.data_end    || defaultEnd   || '',
    masina_naveta: item.masina_naveta || '',
    observatii:  item.observatii  || '',
  })
  const [saving, setSaving] = useState(false)
  const [empSearch, setEmpSearch] = useState(item.employee_name || '')
  const [showEmpList, setShowEmpList] = useState(false)

  // Autocomplete angajați
  const empFiltered = useMemo(() => {
    if (!empSearch.trim() || empSearch.length < 2) return []
    const s = empSearch.toLowerCase()
    return employees.filter(e =>
      e.name.toLowerCase().includes(s) || (e.functie||'').toLowerCase().includes(s)
    ).slice(0, 8)
  }, [empSearch, employees])

  const selectEmployee = e => {
    setF(f => ({...f, employee_id: e.id}))
    setEmpSearch(e.name)
    setShowEmpList(false)
  }

  const handleSave = async () => {
    if (!f.proiect_id) return onError('Selectează proiectul')
    if (!f.employee_id) return onError('Selectează angajatul')
    if (!f.data_start || !f.data_end) return onError('Completează fereastra turei')
    if (new Date(f.data_end) < new Date(f.data_start)) return onError('Data end trebuie să fie după data start')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      proiect_id:    Number(f.proiect_id),
      employee_id:   Number(f.employee_id),
      meserie:       f.meserie || null,
      echipa:        f.echipa.trim() || null,
      data_start:    f.data_start,
      data_end:      f.data_end,
      masina_naveta: f.masina_naveta.trim() || null,
      observatii:    f.observatii.trim() || null,
      alocat_de:     user?.id,
      updated_at:    new Date().toISOString(),
    }
    const res = isNew
      ? await supabase.from('executie_alocari_personal').insert(payload)
      : await supabase.from('executie_alocari_personal').update(payload).eq('id', item.id)
    setSaving(false)
    if (res.error) onError(res.error.message)
    else onSaved()
  }

  const meserieActuala = getMeserie(f.meserie)

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24
    }}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:540, maxHeight:'90vh', overflow:'auto',
        padding:'22px 26px', boxShadow:'0 20px 60px rgba(0,0,0,.5)'
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18}}>
          <div style={{fontSize:17, fontWeight:800, color:G.text}}>
            {isNew ? '＋ Adaugă persoană în tură' : `✏️ Editează: ${item.employee_name}`}
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          {/* Proiect */}
          <div>
            <label style={S.lbl}>Proiect *</label>
            <select value={f.proiect_id} onChange={e => setF({...f, proiect_id:e.target.value})} style={S.input}>
              <option value="">— Selectează —</option>
              {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern}</option>)}
            </select>
          </div>

          {/* Angajat cu autocomplete */}
          <div style={{position:'relative'}}>
            <label style={S.lbl}>Angajat * {f.employee_id && <span style={{color:G.green}}>✓</span>}</label>
            <input
              value={empSearch}
              onChange={e => { setEmpSearch(e.target.value); setShowEmpList(true); if(!e.target.value) setF({...f,employee_id:''}) }}
              onFocus={() => setShowEmpList(true)}
              placeholder="Caută după nume sau funcție..."
              style={S.input}
            />
            {showEmpList && empFiltered.length > 0 && (
              <div style={{
                position:'absolute', top:'100%', left:0, right:0, zIndex:100,
                background:G.surface, border:`1px solid ${G.border}`, borderRadius:6,
                boxShadow:'0 8px 24px rgba(0,0,0,.4)', maxHeight:220, overflowY:'auto'
              }}>
                {empFiltered.map(e => (
                  <div key={e.id}
                    onClick={() => selectEmployee(e)}
                    onMouseDown={ev => ev.preventDefault()}
                    style={{
                      padding:'10px 14px', cursor:'pointer', fontSize:13,
                      borderBottom:`1px solid ${G.border}`,
                    }}
                    onMouseEnter={ev => ev.currentTarget.style.background=G.bg}
                    onMouseLeave={ev => ev.currentTarget.style.background='transparent'}
                  >
                    <div style={{fontWeight:600, color:G.text}}>{e.name}</div>
                    <div style={{fontSize:10, color:G.muted}}>{e.functie} · {e.department}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Meserie */}
          <div>
            <label style={S.lbl}>Meserie</label>
            <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:6}}>
              {MESERII.map(m => (
                <button key={m.key} onClick={() => setF({...f, meserie:m.key})}
                  style={{
                    padding:'8px 6px', border:`2px solid ${f.meserie===m.key ? m.color : G.border}`,
                    borderRadius:7, cursor:'pointer', fontSize:11, fontWeight:700,
                    background: f.meserie===m.key ? m.color+'22' : G.bg,
                    color: f.meserie===m.key ? m.color : G.muted,
                    textAlign:'center', lineHeight:1.3,
                    transition:'all .1s'
                  }}>
                  <div style={{fontSize:16, marginBottom:2}}>{m.icon}</div>
                  {m.label.split(' ').slice(0,2).join(' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Echipă */}
          <div>
            <label style={S.lbl}>Echipă</label>
            <input value={f.echipa} onChange={e => setF({...f, echipa:e.target.value})}
              style={S.input} placeholder="ex: Echipa 1 Cuplări, Echipa 4 Izolat, Pază" />
          </div>

          {/* Fereastră tură */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.lbl}>Start tură *</label>
              <input type="date" value={f.data_start} onChange={e => setF({...f, data_start:e.target.value})} style={S.input} />
            </div>
            <div>
              <label style={S.lbl}>End tură *</label>
              <input type="date" value={f.data_end} onChange={e => setF({...f, data_end:e.target.value})} style={S.input} />
            </div>
          </div>

          {/* Mașină navetă */}
          <div>
            <label style={S.lbl}>🚗 Mașină navetă (dacă conduce)</label>
            <input value={f.masina_naveta} onChange={e => setF({...f, masina_naveta:e.target.value})}
              style={S.input} placeholder="ex: PH 10 GZP — Dacia Duster" />
          </div>

          {/* Observații */}
          <div>
            <label style={S.lbl}>Observații</label>
            <textarea value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})}
              style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} />
          </div>

          {/* Butoane */}
          <div style={{display:'flex', gap:10, marginTop:4}}>
            <button onClick={onClose}
              style={{...S.btn, flex:1, background:G.border2, color:G.text}}>
              Anulează
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{...S.btn, flex:2, background:saving?G.muted:G.executie, color:'#0D1117', opacity:saving?0.6:1}}>
              {saving ? '⏳ Se salvează...' : isNew ? '＋ Adaugă în tură' : '💾 Salvează'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// SECȚIUNE UTILAJE PE TURĂ (adăugată în main component prin export separat)
// ══════════════════════════════════════════════════════════
export function UtilajeTura({ proiectId, proiecte, siteId, dataStart, dataEnd, canWrite, isOwner }) {
  const [utilaje, setUtilaje] = useState([])       // toate utilajele active
  const [alocari, setAlocari] = useState([])        // alocari in fereastra
  const [allUtilaje, setAllUtilaje] = useState([]) // pentru autocomplete
  const [loading, setLoading] = useState(true)
  const [editAlocare, setEditAlocare] = useState(null)
  const [filterCat, setFilterCat] = useState('all')
  const { show, Toast } = useToast()

  const loadUtilaje = useCallback(async () => {
    if (!siteId && !proiectId) return
    setLoading(true)
    try {
      // Utilaje pe șantier + toate pentru autocomplete
      const [uRes, aRes, allRes] = await Promise.all([
        // Utilaje fizic pe site
        supabase.from('logistica_active')
          .select(`id, marca, model, cod_intern, nr_inmatriculare, stare, site_id, 
                   km_actuali, ore_functionare_actuale, deep_sleep, 
                   logistica_categorii(tip)`)
          .eq('vandut', false)
          .eq('site_id', siteId || 0)
          .order('marca'),
        // Alocări formale în fereastra
        siteId ? supabase.from('logistica_alocari')
          .select(`id, active_id, status, data_start, data_end, justificare,
                   logistica_active(id, marca, model, cod_intern, nr_inmatriculare, stare, 
                                    logistica_categorii(tip))`)
          .eq('site_id', siteId)
          .in('status', ['aprobat','in_tranzit','livrat'])
          .gte('data_end', dataStart)
          .lte('data_start', dataEnd) : { data: [] },
        // Toate utilajele pentru modal
        supabase.from('logistica_active')
          .select('id, marca, model, cod_intern, nr_inmatriculare, stare, logistica_categorii(tip)')
          .eq('vandut', false).eq('deep_sleep', false).order('marca').limit(300),
      ])
      setUtilaje(uRes.data || [])
      setAlocari(aRes.data || [])
      setAllUtilaje(allRes.data || [])
    } finally {
      setLoading(false)
    }
  }, [siteId, proiectId, dataStart, dataEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadUtilaje() }, [loadUtilaje])

  // Categorii distincte
  const categorii = useMemo(() => {
    const cats = new Set()
    utilaje.forEach(u => { if (u.logistica_categorii?.tip) cats.add(u.logistica_categorii.tip) })
    alocari.forEach(a => { if (a.logistica_active?.logistica_categorii?.tip) cats.add(a.logistica_active.logistica_categorii.tip) })
    return Array.from(cats).sort()
  }, [utilaje, alocari])

  // KPI
  const totalPeSite = utilaje.length
  const nefunctionale = utilaje.filter(u => u.stare === 'Nefunctional' || u.deep_sleep).length
  const functionale = totalPeSite - nefunctionale
  const alocateFornal = alocari.length

  // IDs deja alocate formal (pentru a nu dubla)
  const alocateIds = new Set(alocari.map(a => a.active_id))

  // Utilaje filtrate pentru afișare
  const utilajeFiltrate = useMemo(() => {
    let list = utilaje
    if (filterCat !== 'all') list = list.filter(u => u.logistica_categorii?.tip === filterCat)
    return list
  }, [utilaje, filterCat])

  const alociFilterate = useMemo(() => {
    if (filterCat === 'all') return alocari
    return alocari.filter(a => a.logistica_active?.logistica_categorii?.tip === filterCat)
  }, [alocari, filterCat])

  const handleDeleteAlocare = async a => {
    if (!confirm(`Elimini ${a.logistica_active?.marca} ${a.logistica_active?.model} din tură?`)) return
    const { error } = await supabase.from('logistica_alocari').delete().eq('id', a.id)
    if (error) show('Eroare: ' + error.message, 'err')
    else { show('✓ Utilaj eliminat din tură'); loadUtilaje() }
  }

  const utilizareLabel = u => {
    if (u.deep_sleep) return { label:'💤 Deep Sleep', color:'#8B5CF6' }
    if (u.stare === 'Nefunctional') return { label:'🔴 Nefuncțional', color:G.red }
    if (alocateIds.has(u.id)) return { label:'✅ Alocat tură', color:G.green }
    return { label:'🟡 Liber', color:G.yellow }
  }

  if (!siteId) return (
    <div style={{padding:'20px 0', textAlign:'center', color:G.dim, fontSize:12}}>
      ⚠ Proiectul selectat nu are un șantier asociat — setează șantierul în Dashboard Proiecte.
    </div>
  )

  return (
    <div style={{marginTop:28}}>
      {/* ─── SEPARATOR ─── */}
      <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:18}}>
        <div style={{height:1, flex:1, background:G.border}} />
        <div style={{fontSize:14, fontWeight:800, color:G.text, display:'flex', alignItems:'center', gap:8}}>
          🚜 Utilaje pe tură
        </div>
        <div style={{height:1, flex:1, background:G.border}} />
        {canWrite && (
          <button onClick={() => setEditAlocare({ site_id: siteId, data_start: dataStart, data_end: dataEnd })}
            style={{...S.btn, background:G.orange, color:'#fff', padding:'7px 14px', fontSize:12}}>
            ＋ Adaugă utilaj
          </button>
        )}
      </div>

      {/* ─── KPI UTILAJE ─── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px,1fr))', gap:10, marginBottom:18}}>
        {[
          { label:'Pe șantier', value:totalPeSite, icon:'🏗️', color:G.executie },
          { label:'Funcționale', value:functionale, icon:'✅', color:G.green },
          { label:'Nefuncționale', value:nefunctionale, icon:'🔴', color:G.red },
          { label:'Alocate tură', value:alocateFornal, icon:'📋', color:G.orange },
          { label:'Libere (est.)', value:Math.max(0, functionale - alocateFornal), icon:'🟡', color:G.yellow },
        ].map((k, i) => (
          <div key={i} style={{
            background:G.surface, border:`1px solid ${G.border}`, borderRadius:9,
            padding:'10px 14px', textAlign:'center'
          }}>
            <div style={{fontSize:18, marginBottom:3}}>{k.icon}</div>
            <div style={{fontSize:22, fontWeight:800, color:k.color}}>{k.value}</div>
            <div style={{fontSize:10, color:G.muted, marginTop:1}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ─── FILTRU CATEGORIE ─── */}
      {categorii.length > 1 && (
        <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:14}}>
          <button onClick={() => setFilterCat('all')}
            style={{...S.btn, padding:'4px 12px', fontSize:11,
              background: filterCat==='all' ? G.orange+'33' : G.border2,
              color: filterCat==='all' ? G.orange : G.muted,
              border:`1px solid ${filterCat==='all' ? G.orange : G.border}`}}>
            Toate ({utilaje.length})
          </button>
          {categorii.map(cat => {
            const cnt = utilaje.filter(u => u.logistica_categorii?.tip === cat).length
            return (
              <button key={cat} onClick={() => setFilterCat(filterCat===cat ? 'all' : cat)}
                style={{...S.btn, padding:'4px 12px', fontSize:11,
                  background: filterCat===cat ? G.orange+'33' : G.border2,
                  color: filterCat===cat ? G.orange : G.muted,
                  border:`1px solid ${filterCat===cat ? G.orange : G.border}`}}>
                {cat} ({cnt})
              </button>
            )
          })}
        </div>
      )}

      {/* ─── ALOCĂRI FORMALE ─── */}
      {alociFilterate.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11, fontWeight:700, color:G.orange, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8}}>
            📋 Alocate formal în tură ({alociFilterate.length})
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            {alociFilterate.map(a => {
              const u = a.logistica_active || {}
              return (
                <div key={a.id} style={{
                  display:'grid', gridTemplateColumns:'1fr auto auto auto', alignItems:'center', gap:12,
                  padding:'10px 14px', background:G.green+'11',
                  border:`1px solid ${G.green}44`, borderRadius:8
                }}>
                  <div>
                    <span style={{fontWeight:700, color:G.text, fontSize:13}}>
                      {u.marca} {u.model}
                    </span>
                    {u.nr_inmatriculare && <span style={{color:G.muted, fontSize:11, marginLeft:8}}>{u.nr_inmatriculare}</span>}
                    {u.cod_intern && <span style={{color:G.dim, fontSize:10, marginLeft:6}}>({u.cod_intern})</span>}
                  </div>
                  <span style={{padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700, background:G.green+'22', color:G.green}}>
                    ✅ Alocat
                  </span>
                  <div style={{fontSize:10, color:G.muted}}>
                    {fmtDateShort(a.data_start)} → {fmtDateShort(a.data_end)}
                  </div>
                  {(canWrite) && (
                    <button onClick={() => handleDeleteAlocare(a)}
                      style={{...S.btn, padding:'3px 8px', fontSize:10, background:G.red+'22', color:G.red, border:`1px solid ${G.red}44`}}>
                      🗑
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── UTILAJE PE ȘANTIER ─── */}
      {loading ? (
        <div style={{padding:30, textAlign:'center', color:G.muted, fontSize:12}}>⏳ Se încarcă utilajele...</div>
      ) : utilajeFiltrate.length === 0 ? (
        <div style={{
          padding:'30px 20px', textAlign:'center', color:G.muted,
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, fontSize:13
        }}>
          <div style={{fontSize:32, marginBottom:8}}>🚜</div>
          Niciun utilaj fizic înregistrat pe șantierul acestui proiect.
          <div style={{fontSize:11, marginTop:6}}>Utilajele se alocă din modulul Logistică → pagina utilajului → câmpul Șantier.</div>
        </div>
      ) : (
        <>
          <div style={{fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8}}>
            🏗️ Utilaje fizice pe șantier ({utilajeFiltrate.length})
          </div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px,1fr))', gap:10}}>
            {utilajeFiltrate.map(u => {
              const uz = utilizareLabel(u)
              const cat = u.logistica_categorii?.tip || '—'
              return (
                <div key={u.id} style={{
                  background:G.surface, border:`1px solid ${G.border}`,
                  borderRadius:9, padding:'12px 14px',
                  borderLeft:`3px solid ${uz.color}`,
                }}>
                  <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:8}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:700, color:G.text, fontSize:13, lineHeight:1.2}}>
                        {u.marca} {u.model}
                      </div>
                      <div style={{fontSize:10, color:G.dim, marginTop:2}}>
                        {u.nr_inmatriculare || u.cod_intern || '—'}
                        {u.cod_intern && u.nr_inmatriculare && ` · ${u.cod_intern}`}
                      </div>
                    </div>
                    <span style={{
                      padding:'2px 7px', borderRadius:10, fontSize:9, fontWeight:700,
                      background: uz.color+'22', color: uz.color, whiteSpace:'nowrap', flexShrink:0
                    }}>{uz.label}</span>
                  </div>
                  <div style={{display:'flex', gap:12, fontSize:10, color:G.muted}}>
                    <span>📂 {cat}</span>
                    {u.km_actuali && <span>🛣 {u.km_actuali.toLocaleString('ro-RO')} km</span>}
                    {u.ore_functionare_actuale && <span>⏱ {Math.round(u.ore_functionare_actuale)} h</span>}
                  </div>
                  {canWrite && !alocateIds.has(u.id) && !u.deep_sleep && u.stare !== 'Nefunctional' && (
                    <button
                      onClick={() => setEditAlocare({
                        site_id: siteId, active_id: u.id,
                        _utilaj_label: `${u.marca} ${u.model} ${u.nr_inmatriculare||u.cod_intern||''}`,
                        data_start: dataStart, data_end: dataEnd
                      })}
                      style={{...S.btn, marginTop:8, width:'100%', padding:'5px', fontSize:11,
                        background:G.orange+'22', color:G.orange, border:`1px solid ${G.orange}44`}}>
                      + Adaugă în tură
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* MODAL ALOCARE UTILAJ */}
      {editAlocare && (
        <AlocareUtilajModal
          item={editAlocare}
          allUtilaje={allUtilaje}
          onClose={() => setEditAlocare(null)}
          onSaved={() => { setEditAlocare(null); loadUtilaje(); show('✓ Utilaj adăugat în tură') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}

      <Toast />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ALOCARE UTILAJ
// ══════════════════════════════════════════════════════════
function AlocareUtilajModal({ item, allUtilaje, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    active_id:   item.active_id || '',
    site_id:     item.site_id   || '',
    data_start:  item.data_start || '',
    data_end:    item.data_end   || '',
    justificare: item.justificare || '',
  })
  const [saving, setSaving] = useState(false)
  const [utilajSearch, setUtilajSearch] = useState(item._utilaj_label || '')
  const [showList, setShowList] = useState(false)

  const utilajFiltered = useMemo(() => {
    if (!utilajSearch.trim() || utilajSearch.length < 2) return []
    const s = utilajSearch.toLowerCase()
    return allUtilaje.filter(u =>
      `${u.marca} ${u.model} ${u.nr_inmatriculare||''} ${u.cod_intern||''}`.toLowerCase().includes(s)
    ).slice(0, 8)
  }, [utilajSearch, allUtilaje])

  const selectUtilaj = u => {
    setF(f => ({...f, active_id: u.id}))
    setUtilajSearch(`${u.marca} ${u.model} ${u.nr_inmatriculare || u.cod_intern || ''}`)
    setShowList(false)
  }

  const handleSave = async () => {
    if (!f.active_id) return onError('Selectează utilajul')
    if (!f.data_start || !f.data_end) return onError('Completează fereastra turei')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('logistica_alocari').insert({
      active_id:   Number(f.active_id),
      site_id:     Number(f.site_id),
      status:      'aprobat',
      data_start:  f.data_start,
      data_end:    f.data_end,
      justificare: f.justificare.trim() || 'Alocare tură',
      solicitata_de: user?.id,
      aprobata_de:   user?.id,
      data_cerere:   new Date().toISOString(),
      data_decizie:  new Date().toISOString(),
    })
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <div onClick={e => e.target===e.currentTarget && onClose()} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24
    }}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:480, padding:'22px 26px',
        boxShadow:'0 20px 60px rgba(0,0,0,.5)'
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>
            🚜 {isNew ? 'Adaugă utilaj în tură' : 'Editează alocare'}
          </div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          {/* Utilaj autocomplete */}
          <div style={{position:'relative'}}>
            <label style={S.lbl}>Utilaj * {f.active_id && <span style={{color:G.green}}>✓</span>}</label>
            <input value={utilajSearch}
              onChange={e => { setUtilajSearch(e.target.value); setShowList(true); if(!e.target.value) setF({...f,active_id:''}) }}
              onFocus={() => setShowList(true)}
              placeholder="Caută marcă, model, plăcuță, cod intern..."
              style={S.input} />
            {showList && utilajFiltered.length > 0 && (
              <div style={{
                position:'absolute', top:'100%', left:0, right:0, zIndex:100,
                background:G.surface, border:`1px solid ${G.border}`, borderRadius:6,
                boxShadow:'0 8px 24px rgba(0,0,0,.4)', maxHeight:200, overflowY:'auto'
              }}>
                {utilajFiltered.map(u => (
                  <div key={u.id} onClick={() => selectUtilaj(u)}
                    onMouseDown={ev => ev.preventDefault()}
                    style={{padding:'9px 14px', cursor:'pointer', borderBottom:`1px solid ${G.border}`}}
                    onMouseEnter={ev => ev.currentTarget.style.background=G.bg}
                    onMouseLeave={ev => ev.currentTarget.style.background='transparent'}>
                    <div style={{fontWeight:600, color:G.text, fontSize:12}}>
                      {u.marca} {u.model}
                    </div>
                    <div style={{fontSize:10, color:G.muted}}>
                      {u.nr_inmatriculare || u.cod_intern} · {u.logistica_categorii?.tip} · {u.stare}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fereastră */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.lbl}>Start tură *</label>
              <input type="date" value={f.data_start} onChange={e => setF({...f,data_start:e.target.value})} style={S.input} />
            </div>
            <div>
              <label style={S.lbl}>End tură *</label>
              <input type="date" value={f.data_end} onChange={e => setF({...f,data_end:e.target.value})} style={S.input} />
            </div>
          </div>

          <div>
            <label style={S.lbl}>Justificare / Notă</label>
            <input value={f.justificare} onChange={e => setF({...f,justificare:e.target.value})}
              style={S.input} placeholder="ex: Excavație tronson 3" />
          </div>

          <div style={{padding:'8px 12px', background:G.orange+'11', border:`1px solid ${G.orange}44`, borderRadius:6, fontSize:11, color:G.orange}}>
            ✅ Alocarea se aprobă automat — status „Aprobat" direct.
          </div>

          <div style={{display:'flex', gap:10}}>
            <button onClick={onClose} style={{...S.btn, flex:1, background:G.border2, color:G.text}}>Anulează</button>
            <button onClick={handleSave} disabled={saving}
              style={{...S.btn, flex:2, background:saving?G.muted:G.orange, color:'#fff', opacity:saving?0.6:1}}>
              {saving ? '⏳...' : '🚜 Adaugă în tură'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
