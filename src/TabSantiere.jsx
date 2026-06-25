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
import * as XLSX from 'xlsx-js-style'

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
// proiectId: prop opțional — când vine din ProiectContextView, ascundem selectorii
// ══════════════════════════════════════════════════════════
export default function TabSantiere({ proiectId: proiectIdProp }) {
  const [proiecte, setProiecte] = useState([])
  const [employees, setEmployees] = useState([])
  const [masiniLista, setMasiniLista] = useState([])
  const [alocari, setAlocari] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Filtre
  const [proiectId, setProiectId] = useState(proiectIdProp ? String(proiectIdProp) : '')
  const [dataStart, setDataStart] = useState(() => {
    const d = new Date(); return d.toISOString().slice(0,10)  // default: azi
  })
  const [dataEnd, setDataEnd] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0,10)  // default: azi + 10 zile
  })
  const [filterMeserie, setFilterMeserie] = useState('all')
  const [searchEmp, setSearchEmp] = useState('')

  const [editAlocare, setEditAlocare] = useState(null)
  const [editEchipa, setEditEchipa] = useState(null)
  const [showArhiva, setShowArhiva] = useState(false)
  const [turaId, setTuraId] = useState(null) // tura activa din executie_ture
  const [vista, setVista] = useState('personal') // 'personal' | 'probe'
  const { show, Toast } = useToast()

  // Sync cu prop când proiectul se schimbă din context
  useEffect(() => {
    if (proiectIdProp) setProiectId(String(proiectIdProp))
  }, [proiectIdProp])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role').eq('id',user.id).single()
        setProfile(prof)
      }
      const [pRes, eRes, mRes] = await Promise.all([
        supabase.from('executie_proiecte').select('id,cod_intern,nume,activ,site_id').eq('activ',true).order('cod_intern'),
        supabase.from('employees').select('id,name,functie,department').eq('active',true).order('name'),
        supabase.from('logistica_active')
          .select('id,marca,model,nr_inmatriculare,cod_intern,logistica_categorii(tip)')
          .eq('vandut',false).eq('deep_sleep',false)
          .order('nr_inmatriculare').limit(200),
      ])
      setProiecte(pRes.data || [])
      setEmployees(eRes.data || [])
      const TIPURI_NAVETA = ['Autoturism','Autoutilitară','Autoutilitara','Camion']
      setMasiniLista((mRes.data || []).filter(m => TIPURI_NAVETA.includes(m.logistica_categorii?.tip)))
      if (!proiectIdProp && !proiectId && pRes.data?.length > 0) setProiectId(String(pRes.data[0].id))
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
      .lte('data_start', dataEnd)    // tura incepe inainte de end fereastra
      .gte('data_end', dataStart)    // tura se termina dupa start fereastra
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
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:12}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800, color:G.text}}>
            {vista==='probe' ? '🔬 Calculator probe de presiune' : '🏗️ Alocare personal pe tură'}
          </h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>
            {vista==='probe' ? 'Pneumatic / Hidraulic · volum · durată · consum motorină' : 'Plan tură · Meserii · Echipe · Plan vs Realizat'}
          </div>
        </div>
        {vista==='personal' && canWrite && (
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <button
              onClick={() => setEditEchipa({ proiect_id: proiectId, data_start: dataStart, data_end: dataEnd })}
              style={{...S.btn, background:G.executie, color:'#0D1117', display:'flex', alignItems:'center', gap:8}}
            >＋ Adaugă echipă</button>
            <button onClick={() => exportTuraExcel({ proiectId, dataStart, dataEnd, alocari, proiecte, employees })}
              style={{...S.btn, background:G.green, color:'#fff', padding:'7px 12px', fontSize:12, fontWeight:700}}>
              📥 Excel
            </button>
            <button onClick={() => setShowArhiva(true)}
              style={{...S.btn, background:G.border2, color:G.muted, padding:'7px 12px', fontSize:12}}>
              📁 Arhivă
            </button>
          </div>
        )}
      </div>

      {/* ─── TAB-URI INTERNE ─── */}
      <div style={{display:'flex', gap:8, marginBottom:20, borderBottom:`1px solid ${G.border}`}}>
        {[
          { key:'personal', label:'🏗️ Personal' },
          { key:'probe',    label:'🔬 Probe presiune' },
        ].map(t => (
          <button key={t.key} onClick={() => setVista(t.key)}
            style={{
              padding:'10px 18px', border:'none', background:'transparent', cursor:'pointer',
              fontSize:13, fontWeight:700,
              color: vista===t.key ? G.executie : G.muted,
              borderBottom: vista===t.key ? `2px solid ${G.executie}` : '2px solid transparent',
              marginBottom:-1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ VISTA PROBE ═══ */}
      {vista==='probe' && (
        <CalculatorProbe proiectId={proiectId} proiecte={proiecte} canWrite={canWrite} profile={profile} onToast={show} />
      )}

      {/* ═══ VISTA PERSONAL ═══ */}
      {vista==='personal' && (<>
      {/* ─── FILTRE TURĂ ─── */}
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:10,
        padding:'16px 20px', marginBottom:20,
        display:'grid', gridTemplateColumns: proiectIdProp ? '1fr 1fr auto' : '2fr 1fr 1fr auto', gap:14, alignItems:'end'
      }}>
        {/* Selector proiect — ascuns când vine din ProiectContextView */}
        {!proiectIdProp && (
          <div>
            <label style={S.lbl}>Proiect</label>
            <select value={proiectId} onChange={e => setProiectId(e.target.value)} style={S.input}>
              {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume.slice(0,50)}</option>)}
            </select>
          </div>
        )}
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
          <div style={{display:'flex', gap:4, marginTop:4}}>
            {[
              {l:'↺ Curentă', fn: () => { const s=new Date(); const e=new Date(); e.setDate(e.getDate()+10); setDataStart(s.toISOString().slice(0,10)); setDataEnd(e.toISOString().slice(0,10)) }},
              {l:'08-17 Iun', fn: () => { setDataStart('2026-06-08'); setDataEnd('2026-06-17') }},
              {l:'18-27 Iun', fn: () => { setDataStart('2026-06-18'); setDataEnd('2026-06-27') }},
              {l:'Luna', fn: () => { const s=new Date(); s.setDate(1); const e=new Date(s.getFullYear(), s.getMonth()+1, 0); setDataStart(s.toISOString().slice(0,10)); setDataEnd(e.toISOString().slice(0,10)) }},
            ].map(p => (
              <button key={p.l} onClick={p.fn}
                style={{padding:'2px 8px', fontSize:10, border:`1px solid ${G.border}`, borderRadius:4, cursor:'pointer', background:G.bg, color:G.muted, fontWeight:600}}>
                {p.l}
              </button>
            ))}
          </div>
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
            <div style={{fontSize:13}}>Apasă „＋ Adaugă echipă" pentru a aloca primul angajat.</div>
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

      {editEchipa && (
        <EchipaModal
          proiecte={proiecte}
          employees={employees}
          defaultProiectId={proiectId}
          defaultStart={dataStart}
          defaultEnd={dataEnd}
          onClose={() => setEditEchipa(null)}
          onSaved={() => { setEditEchipa(null); loadAlocari(); show('✓ Echipă adăugată!') }}
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
        employees={employees}
      />

      <NavetaTura
        proiectId={proiectId}
        siteId={currentSiteId}
        dataStart={dataStart}
        dataEnd={dataEnd}
        canWrite={canWrite}
        employees={employees}
        masiniLista={masiniLista}
      />

      <SubcontractoriTura
        proiectId={proiectId}
        siteId={currentSiteId}
        dataStart={dataStart}
        dataEnd={dataEnd}
        canWrite={canWrite}
      />

      <ActivitatiTura
        proiectId={proiectId}
        siteId={currentSiteId}
        dataStart={dataStart}
        dataEnd={dataEnd}
        canWrite={canWrite}
      />
      </>)}

      {showArhiva && (
        <ArhivaModal
          proiectId={proiectId}
          proiecte={proiecte}
          onClose={() => setShowArhiva(false)}
          onSelectTura={(t) => {
            setDataStart(t.data_start)
            setDataEnd(t.data_end)
            setShowArhiva(false)
          }}
        />
      )}

      <Toast />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MOTOR DE CALCUL PROBE (shared — folosit și de modulul Comercial)
// ══════════════════════════════════════════════════════════
// Returnează toate rezultatele pentru un set de inputuri.
// dn = { diametru_extern_mm }, cfg = { tip_fluid, debit_mc_min, debit_l_min, consum_motorina_l_h, tarif_lei_mc }
function calcProbe({ dn, lungime_m, presiune_bar, cfg }) {
  const L = Number(lungime_m) || 0
  const P = Number(presiune_bar) || 0
  const dExtM = (Number(dn?.diametru_extern_mm) || 0) / 1000
  const v1m = Math.PI * Math.pow(dExtM / 2, 2)   // mc per 1m la 1 bar
  const v_conducta = v1m * L                      // mc

  if (cfg?.tip_fluid === 'apa') {
    // ─── HIDRAULIC ───
    const dP = Math.max(0, P - 10)                 // ΔP (presiune utilă peste 10 bar)
    const beta = 0.00005                           // compresibilitate apă 1/bar
    const v_compr = v_conducta * dP * beta         // mc
    const debitL = Number(cfg?.debit_l_min) || 0   // L/min pompă principală
    const timp_umplere_h = v_conducta / (1000 * 60 / 1000)      // pompă umplere 1000 L/min → mc/h = 60
    const timp_presurizare_h = debitL > 0 ? (v_compr * 1000) / (debitL * 60) : 0
    const durata_total_h = timp_umplere_h + timp_presurizare_h
    const consum = (Number(cfg?.consum_motorina_l_h) || 0) * durata_total_h
    const valoare = v_conducta * (Number(cfg?.tarif_lei_mc) || 0)
    return {
      v_conducta_mc: v_conducta, v_la_presiune_mc: v_compr,
      timp_umplere_h, timp_presurizare_h,
      durata_proba_h: timp_presurizare_h, durata_pistonare_h: 0,
      durata_total_h, consum_motorina_l: consum, valoare_lei: valoare,
    }
  }

  // ─── PNEUMATIC ───
  const debit = Number(cfg?.debit_mc_min) || 0     // mc/min
  const v_la_presiune = v_conducta * P             // mc aer echivalent la 1 bar
  const durata_proba_h = debit > 0 ? v_la_presiune / (debit * 60) : 0
  // Pistonare la P=3 bar fix. Uscare + Calibrare = identice ca durată.
  const durata_pistonare_h = debit > 0 ? (v_conducta * 3) / (debit * 60) : 0
  const uscare_h = durata_pistonare_h
  const calibrare_h = durata_pistonare_h
  const durata_total_h = durata_proba_h + durata_pistonare_h + uscare_h + calibrare_h
  const consum = (Number(cfg?.consum_motorina_l_h) || 0) * durata_total_h
  return {
    v_conducta_mc: v_conducta, v_la_presiune_mc: v_la_presiune,
    durata_proba_h, durata_pistonare_h, uscare_h, calibrare_h,
    timp_umplere_h: 0, timp_presurizare_h: 0,
    durata_total_h, consum_motorina_l: consum, valoare_lei: 0,
  }
}

const fmtH = h => {
  const n = Number(h) || 0
  if (n === 0) return '0 h'
  if (n < 1) return `${Math.round(n*60)} min`
  return `${n.toFixed(2)} h`
}
const fmtNr = (n, d=2) => (Number(n)||0).toLocaleString('ro-RO', { minimumFractionDigits:d, maximumFractionDigits:d })

// ══════════════════════════════════════════════════════════
// CALCULATOR PROBE DE PRESIUNE (vista din TabSantiere)
// ══════════════════════════════════════════════════════════
function CalculatorProbe({ proiectId, proiecte, canWrite, profile, onToast }) {
  const [tipFluid, setTipFluid] = useState('aer')   // 'aer' | 'apa'
  const [diametre, setDiametre] = useState([])
  const [configs, setConfigs] = useState([])
  const [tronsoane, setTronsoane] = useState([])
  const [loading, setLoading] = useState(true)
  const [salvari, setSalvari] = useState([])

  // Inputuri
  const [dnId, setDnId] = useState('')
  const [tronsonId, setTronsonId] = useState('')
  const [lungime, setLungime] = useState('')
  const [presiune, setPresiune] = useState('')
  const [configId, setConfigId] = useState('')
  const [editConfig, setEditConfig] = useState(null)

  // ─── Load cataloage ───
  const loadCat = useCallback(async () => {
    setLoading(true)
    const [dRes, cRes] = await Promise.all([
      supabase.from('probe_diametre').select('*').eq('activ', true).order('ordine'),
      supabase.from('probe_configuratii').select('*').eq('activ', true).order('id'),
    ])
    setDiametre(dRes.data || [])
    setConfigs(cRes.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { loadCat() }, [loadCat])

  // ─── Load tronsoane proiect (pentru lungime auto) ───
  useEffect(() => {
    if (!proiectId) { setTronsoane([]); return }
    supabase.from('executie_tronsoane')
      .select('id, cod, denumire, lungime_planificata_km')
      .eq('proiect_id', proiectId).order('ordine')
      .then(({ data }) => setTronsoane(data || []))
  }, [proiectId])

  // ─── Load calcule salvate ───
  const loadSalvari = useCallback(async () => {
    if (!proiectId) { setSalvari([]); return }
    const { data } = await supabase.from('probe_calcule')
      .select('*, probe_diametre(dn_label), probe_configuratii(denumire)')
      .eq('proiect_id', proiectId).order('created_at', { ascending:false }).limit(20)
    setSalvari(data || [])
  }, [proiectId])
  useEffect(() => { loadSalvari() }, [loadSalvari])

  // Config-uri filtrate: tip fluid + presiune_max >= P_probă
  const configFiltrate = useMemo(() => {
    const P = Number(presiune) || 0
    return configs.filter(c => c.tip_fluid === tipFluid && (P === 0 || Number(c.presiune_max_bar) >= P))
  }, [configs, tipFluid, presiune])

  // Auto-completare lungime din tronson selectat (km → m)
  const handleTronson = (tid) => {
    setTronsonId(tid)
    if (tid) {
      const tr = tronsoane.find(t => String(t.id) === String(tid))
      if (tr?.lungime_planificata_km) setLungime(String(Math.round(Number(tr.lungime_planificata_km) * 1000)))
    }
  }

  const dn = diametre.find(d => String(d.id) === String(dnId))
  const cfg = configs.find(c => String(c.id) === String(configId))
  const rez = useMemo(() => {
    if (!dn || !lungime || !presiune || !cfg) return null
    return calcProbe({ dn, lungime_m: lungime, presiune_bar: presiune, cfg })
  }, [dn, lungime, presiune, cfg])

  const handleSalveaza = async () => {
    if (!rez) return onToast('Completează toate câmpurile pentru calcul', 'err')
    if (!proiectId) return onToast('Selectează un proiect mai întâi', 'err')
    const payload = {
      proiect_id: Number(proiectId),
      tronson_id: tronsonId ? Number(tronsonId) : null,
      tip_fluid: tipFluid,
      dn_id: Number(dnId),
      lungime_m: Number(lungime),
      presiune_bar: Number(presiune),
      config_id: Number(configId),
      v_conducta_mc: rez.v_conducta_mc,
      v_la_presiune_mc: rez.v_la_presiune_mc,
      durata_proba_h: rez.durata_proba_h,
      durata_pistonare_h: rez.durata_pistonare_h,
      durata_total_h: rez.durata_total_h,
      consum_motorina_l: rez.consum_motorina_l,
      timp_umplere_h: rez.timp_umplere_h || null,
      timp_presurizare_h: rez.timp_presurizare_h || null,
      valoare_lei: rez.valoare_lei || null,
      created_by: profile?.id || null,
    }
    const { error } = await supabase.from('probe_calcule').insert(payload)
    if (error) return onToast('Eroare salvare: ' + error.message, 'err')
    onToast('✓ Calcul salvat')
    loadSalvari()
  }

  if (loading) return <div style={{padding:40, textAlign:'center', color:G.muted}}>⏳ Se încarcă cataloagele...</div>

  const isAer = tipFluid === 'aer'

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* Toggle Pneumatic / Hidraulic */}
      <div style={{display:'inline-flex', background:G.bg, borderRadius:9, padding:4, gap:4, alignSelf:'flex-start', border:`1px solid ${G.border}`}}>
        {[
          { k:'aer', l:'💨 Pneumatic (aer)' },
          { k:'apa', l:'💧 Hidraulic (apă)' },
        ].map(t => (
          <button key={t.k} onClick={() => { setTipFluid(t.k); setConfigId('') }}
            style={{
              padding:'8px 18px', border:'none', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:700,
              background: tipFluid===t.k ? G.executie : 'transparent',
              color: tipFluid===t.k ? '#0D1117' : G.muted,
            }}>{t.l}</button>
        ))}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, alignItems:'start'}}>
        {/* ─── INPUTURI ─── */}
        <div style={{background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:'18px 20px', display:'flex', flexDirection:'column', gap:14}}>
          <div style={{fontSize:13, fontWeight:800, color:G.text, marginBottom:2}}>📐 Parametri conductă</div>

          <div>
            <label style={S.lbl}>Diametru (DN)</label>
            <select value={dnId} onChange={e => setDnId(e.target.value)} style={S.input}>
              <option value="">— alege diametrul —</option>
              {diametre.map(d => <option key={d.id} value={d.id}>{d.dn_label} ({fmtNr(d.diametru_extern_mm,1)} mm)</option>)}
            </select>
          </div>

          {tronsoane.length > 0 && (
            <div>
              <label style={S.lbl}>Tronson (lungime auto)</label>
              <select value={tronsonId} onChange={e => handleTronson(e.target.value)} style={S.input}>
                <option value="">— manual —</option>
                {tronsoane.map(t => <option key={t.id} value={t.id}>{t.cod}{t.denumire ? ' · '+t.denumire : ''} ({fmtNr(t.lungime_planificata_km,2)} km)</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={S.lbl}>
              Lungime (m) {tronsonId && <span style={{color:G.green, fontWeight:700}}>· auto din tronson</span>}
            </label>
            <input type="number" value={lungime} onChange={e => { setLungime(e.target.value); setTronsonId('') }}
              placeholder="ex: 1000" style={S.input} />
          </div>

          <div>
            <label style={S.lbl}>Presiune probă (bar)</label>
            <input type="number" value={presiune} onChange={e => { setPresiune(e.target.value); setConfigId('') }}
              placeholder="ex: 10" style={S.input} />
          </div>

          <div>
            <label style={S.lbl}>
              Configurație echipament
              {presiune && <span style={{color:G.muted, fontWeight:500}}> · filtrat ≥ {presiune} bar</span>}
            </label>
            <select value={configId} onChange={e => setConfigId(e.target.value)} style={S.input}>
              <option value="">— alege configurația —</option>
              {configFiltrate.map(c => (
                <option key={c.id} value={c.id}>
                  {c.denumire} · {isAer ? `${fmtNr(c.debit_mc_min,0)} mc/min` : `${fmtNr(c.debit_l_min,0)} L/min`} · {fmtNr(c.presiune_max_bar,0)} bar max
                </option>
              ))}
            </select>
            {presiune && configFiltrate.length === 0 && (
              <div style={{fontSize:11, color:G.red, marginTop:6}}>⚠️ Nicio configurație nu suportă {presiune} bar pentru acest tip de fluid.</div>
            )}
          </div>

          {/* Editor config rapid */}
          <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:2}}>
            {canWrite && cfg && (
              <button onClick={() => setEditConfig(cfg)}
                style={{...S.btn, background:G.border2, color:G.muted, padding:'6px 12px', fontSize:11}}>
                ✏️ Editează „{cfg.denumire}"
              </button>
            )}
          </div>
        </div>

        {/* ─── REZULTATE ─── */}
        <div style={{background:G.surface, border:`1px solid ${rez ? G.executie+'66' : G.border}`, borderRadius:10, padding:'18px 20px', display:'flex', flexDirection:'column', gap:12}}>
          <div style={{fontSize:13, fontWeight:800, color:G.text}}>📊 Rezultat estimare</div>

          {!rez ? (
            <div style={{padding:'30px 10px', textAlign:'center', color:G.dim, fontSize:13}}>
              Completează diametru, lungime, presiune și configurație pentru calcul instant.
            </div>
          ) : (<>
            {/* Volum */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <ProbaStat label="Volum conductă" val={`${fmtNr(rez.v_conducta_mc)} mc`} color={G.blue} />
              <ProbaStat label={isAer ? 'Volum aer (la presiune)' : 'Volum compresie'} val={`${fmtNr(rez.v_la_presiune_mc)} mc`} color={G.purple} />
            </div>

            {/* Durate per operație */}
            <div style={{background:G.bg, borderRadius:8, padding:'12px 14px', display:'flex', flexDirection:'column', gap:7}}>
              {isAer ? (<>
                <ProbaRow label="🔧 Pistonare (3 bar)" val={fmtH(rez.durata_pistonare_h)} />
                <ProbaRow label="💨 Uscare" val={fmtH(rez.uscare_h)} />
                <ProbaRow label="🎯 Calibrare" val={fmtH(rez.calibrare_h)} />
                <ProbaRow label="🧪 Probă presiune" val={fmtH(rez.durata_proba_h)} />
              </>) : (<>
                <ProbaRow label="🚰 Umplere" val={fmtH(rez.timp_umplere_h)} />
                <ProbaRow label="⬆️ Presurizare" val={fmtH(rez.timp_presurizare_h)} />
              </>)}
              <div style={{height:1, background:G.border, margin:'3px 0'}} />
              <ProbaRow label="⏱️ TOTAL" val={`${fmtH(rez.durata_total_h)} · ${fmtNr(rez.durata_total_h/24,1)} zile`} bold />
            </div>

            {/* Consum + valoare */}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              <ProbaStat label="⛽ Consum motorină" val={`${fmtNr(rez.consum_motorina_l,0)} L`} color={G.orange} />
              {!isAer && rez.valoare_lei > 0 && (
                <ProbaStat label="💰 Valoare" val={`${fmtNr(rez.valoare_lei,0)} lei`} color={G.green} />
              )}
            </div>

            {/* Disclaimer OBLIGATORIU */}
            <div style={{background:G.yellow+'18', border:`1px solid ${G.yellow}44`, borderRadius:7, padding:'8px 12px', fontSize:11, color:G.yellow, fontWeight:600}}>
              ⚠️ Estimare fără pauze de odihnă oameni/utilaje
            </div>

            {/* Acțiuni */}
            {canWrite && (
              <div style={{display:'flex', gap:8, marginTop:2}}>
                <button onClick={handleSalveaza}
                  style={{...S.btn, flex:1, background:G.greenBg, color:'#fff'}}>💾 Salvează calcul</button>
              </div>
            )}
          </>)}
        </div>
      </div>

      {/* ─── CALCULE SALVATE ─── */}
      {salvari.length > 0 && (
        <div style={{background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, overflow:'hidden'}}>
          <div style={{padding:'12px 18px', borderBottom:`1px solid ${G.border}`, fontSize:13, fontWeight:800, color:G.text}}>
            📋 Calcule salvate ({salvari.length})
          </div>
          {salvari.map((s, i) => (
            <div key={s.id} style={{
              display:'grid', gridTemplateColumns:'auto 1fr auto auto auto', gap:14, alignItems:'center',
              padding:'10px 18px', fontSize:12, color:G.text,
              borderBottom: i < salvari.length-1 ? `1px solid ${G.border}` : 'none',
              background: i%2 ? G.bg+'44' : 'transparent',
            }}>
              <span style={{fontSize:15}}>{s.tip_fluid==='apa' ? '💧' : '💨'}</span>
              <span>
                <strong>{s.probe_diametre?.dn_label || '—'}</strong> · {fmtNr(s.lungime_m,0)}m · {fmtNr(s.presiune_bar,0)} bar
                <span style={{color:G.muted}}> · {s.probe_configuratii?.denumire || ''}</span>
              </span>
              <span style={{color:G.blue}}>{fmtNr(s.v_conducta_mc)} mc</span>
              <span style={{color:G.executie}}>{fmtH(s.durata_total_h)}</span>
              <span style={{color:G.orange}}>{fmtNr(s.consum_motorina_l,0)} L</span>
            </div>
          ))}
        </div>
      )}

      {editConfig && (
        <ConfigProbaModal item={editConfig} onClose={() => setEditConfig(null)}
          onSaved={() => { setEditConfig(null); loadCat(); onToast('✓ Configurație actualizată') }}
          onError={e => onToast('Eroare: ' + e, 'err')} />
      )}
    </div>
  )
}

function ProbaStat({ label, val, color }) {
  return (
    <div style={{background:G.bg, borderRadius:8, padding:'10px 12px'}}>
      <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:3}}>{label}</div>
      <div style={{fontSize:18, fontWeight:800, color}}>{val}</div>
    </div>
  )
}
function ProbaRow({ label, val, bold }) {
  return (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: bold?13:12, fontWeight: bold?800:600, color: bold?G.text:G.muted}}>
      <span>{label}</span>
      <span style={{color: bold?G.executie:G.text}}>{val}</span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL EDITARE CONFIGURAȚIE PROBĂ (tarife + consum editabile)
// ══════════════════════════════════════════════════════════
function ConfigProbaModal({ item, onClose, onSaved, onError }) {
  const isAer = item.tip_fluid === 'aer'
  const [f, setF] = useState({
    denumire: item.denumire || '',
    debit_mc_min: item.debit_mc_min ?? '',
    debit_l_min: item.debit_l_min ?? '',
    presiune_max_bar: item.presiune_max_bar ?? '',
    tarif_lei_h: item.tarif_lei_h ?? '',
    tarif_lei_mc: item.tarif_lei_mc ?? '',
    consum_motorina_l_h: item.consum_motorina_l_h ?? '',
    observatii: item.observatii || '',
  })
  const [saving, setSaving] = useState(false)
  const setK = (k,v) => setF(p => ({...p,[k]:v}))

  const save = async () => {
    if (!f.denumire.trim()) return onError('Denumirea e obligatorie')
    setSaving(true)
    const payload = {
      denumire: f.denumire.trim(),
      presiune_max_bar: f.presiune_max_bar ? Number(f.presiune_max_bar) : null,
      consum_motorina_l_h: f.consum_motorina_l_h ? Number(f.consum_motorina_l_h) : null,
      observatii: f.observatii.trim() || null,
      ...(isAer
        ? { debit_mc_min: f.debit_mc_min ? Number(f.debit_mc_min) : null, tarif_lei_h: f.tarif_lei_h ? Number(f.tarif_lei_h) : null }
        : { debit_l_min: f.debit_l_min ? Number(f.debit_l_min) : null, tarif_lei_mc: f.tarif_lei_mc ? Number(f.tarif_lei_mc) : null }),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('probe_configuratii').update(payload).eq('id', item.id)
    setSaving(false)
    if (error) return onError(error.message)
    onSaved()
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10000, padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{background:G.surface, border:`1px solid ${G.border}`, borderRadius:12, padding:24, width:'100%', maxWidth:440, maxHeight:'90vh', overflowY:'auto'}}>
        <h3 style={{margin:'0 0 16px', fontSize:16, color:G.text}}>✏️ Editează configurație ({isAer ? 'pneumatic' : 'hidraulic'})</h3>
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <div><label style={S.lbl}>Denumire</label><input value={f.denumire} onChange={e=>setK('denumire',e.target.value)} style={S.input} /></div>
          {isAer ? (
            <>
              <div><label style={S.lbl}>Debit (mc/min)</label><input type="number" value={f.debit_mc_min} onChange={e=>setK('debit_mc_min',e.target.value)} style={S.input} /></div>
              <div><label style={S.lbl}>Tarif (lei/h)</label><input type="number" value={f.tarif_lei_h} onChange={e=>setK('tarif_lei_h',e.target.value)} style={{...S.input, color:G.blue}} placeholder="ex: 4000" /></div>
            </>
          ) : (
            <>
              <div><label style={S.lbl}>Debit pompă (L/min)</label><input type="number" value={f.debit_l_min} onChange={e=>setK('debit_l_min',e.target.value)} style={S.input} /></div>
              <div><label style={S.lbl}>Tarif (lei/mc)</label><input type="number" value={f.tarif_lei_mc} onChange={e=>setK('tarif_lei_mc',e.target.value)} style={{...S.input, color:G.blue}} placeholder="ex: 200" /></div>
            </>
          )}
          <div><label style={S.lbl}>Presiune max (bar)</label><input type="number" value={f.presiune_max_bar} onChange={e=>setK('presiune_max_bar',e.target.value)} style={S.input} /></div>
          <div><label style={S.lbl}>Consum motorină (L/h)</label><input type="number" value={f.consum_motorina_l_h} onChange={e=>setK('consum_motorina_l_h',e.target.value)} style={{...S.input, color:G.blue}} placeholder="ex: 145" /></div>
          <div><label style={S.lbl}>Observații</label><input value={f.observatii} onChange={e=>setK('observatii',e.target.value)} style={S.input} /></div>
        </div>
        <div style={{display:'flex', gap:10, marginTop:20}}>
          <button onClick={onClose} style={{...S.btn, flex:1, background:G.border2, color:G.muted}}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btn, flex:1, background:G.greenBg, color:'#fff', opacity:saving?0.6:1}}>{saving ? 'Se salvează...' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ADD/EDIT ALOCARE
// ══════════════════════════════════════════════════════════
function AlocareModal({ item, proiecte, employees, masinaOpts, defaultProiectId, defaultStart, defaultEnd, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    proiect_id:  item.proiect_id  || defaultProiectId || '',
    employee_id: item.employee_id || '',
    meserie:     item.meserie     || 'muncitor_izolator',
    echipa:      item.echipa      || '',
    echipa_rol:  item.echipa_rol  || '',
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
      echipa_rol:    f.echipa_rol || null,
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
    <div  style={{
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

          {/* Echipă + Rol */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            <div>
              <label style={S.lbl}>Echipă</label>
              <select value={f.echipa} onChange={e => setF({...f, echipa:e.target.value})} style={S.input}>
                <option value="">— Selectează —</option>
                <option value="Echipa 1">Echipa 1</option>
                <option value="Echipa 2">Echipa 2</option>
                <option value="Echipa 3">Echipa 3</option>
                <option value="Echipa 4 Izolat">Echipa 4 Izolat</option>
                <option value="Paza / Mecanic / Sofer">Paza / Mecanic / Sofer</option>
                <option value="TESA">TESA</option>
              </select>
            </div>
            <div>
              <label style={S.lbl}>Rol echipă</label>
              <select value={f.echipa_rol} onChange={e => setF({...f, echipa_rol:e.target.value})} style={S.input}>
                <option value="">— Rol —</option>
                <option value="sudura">🔥 Sudură</option>
                <option value="terasamente">⛏️ Terasamente</option>
                <option value="lansare">🚜 Lansare conducta</option>
                <option value="izolare">🧰 Izolare</option>
                <option value="tesa">💼 TESA</option>
                <option value="paza">🛡 Pază</option>
                <option value="mecanic">🔧 Mecanic</option>
                <option value="alt">Alt rol</option>
              </select>
            </div>
          </div>
          {f.echipa && f.echipa_rol && (
            <div style={{padding:'6px 12px', background:G.purple+'11', border:`1px solid ${G.purple}44`, borderRadius:6, fontSize:11, color:G.purple}}>
              👥 {f.echipa} · {f.echipa_rol.charAt(0).toUpperCase()+f.echipa_rol.slice(1)}
            </div>
          )}

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
            <label style={S.lbl}>🚗 Mașină navetă personală (dacă conduce el)</label>
            <input value={f.masina_naveta} onChange={e => setF({...f, masina_naveta:e.target.value})}
              style={S.input} placeholder="ex: PH 10 GZP — Dacia Duster" />
            <div style={{fontSize:10, color:G.dim, marginTop:3}}>
              💡 Mașinile de naveta ale turei (N mașini + șoferi) se adaugă în secțiunea „Mașini naveta" de mai jos.
            </div>
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
export function UtilajeTura({ proiectId, proiecte, siteId, dataStart, dataEnd, canWrite, isOwner, employees }) {
  const [utilaje, setUtilaje] = useState([])       // toate utilajele active
  const [alocari, setAlocari] = useState([])        // alocari in fereastra
  const [allUtilaje, setAllUtilaje] = useState([]) // pentru autocomplete
  const [loading, setLoading] = useState(true)
  const [editAlocare, setEditAlocare] = useState(null)
  const [editBulk, setEditBulk] = useState(false)
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
          .in('status', ['aprobata','activa','incheiata'])
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
          <button onClick={() => setEditBulk(true)}
            style={{...S.btn, background:G.orange, color:'#fff', padding:'7px 14px', fontSize:12}}>
            ＋ Adaugă utilaje
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
          employees={employees||[]}
          utilajeSantier={utilaje}
          onClose={() => setEditAlocare(null)}
          onSaved={() => { setEditAlocare(null); loadUtilaje(); show('✓ Utilaj adăugat în tură') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
      {editBulk && (
        <UtilajeBulkModal
          siteId={siteId}
          dataStart={dataStart}
          dataEnd={dataEnd}
          utilajeSantier={utilaje}
          allUtilaje={allUtilaje}
          employees={employees||[]}
          onClose={() => setEditBulk(false)}
          onSaved={() => { setEditBulk(false); loadUtilaje(); show('✓ Utilaje adăugate în tură!') }}
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
function AlocareUtilajModal({ item, allUtilaje, employees, utilajeSantier, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    active_id:   item.active_id || '',
    site_id:     item.site_id   || '',
    data_start:  item.data_start || '',
    data_end:    item.data_end   || '',
    justificare: item.justificare || '',
    mecanic_id:  item.mecanic_id || '',
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
      status:      'aprobata',
      data_start:  f.data_start,
      data_end:    f.data_end,
      justificare: f.justificare.trim() || 'Alocare tură',
      mecanic_id:  f.mecanic_id ? Number(f.mecanic_id) : null,
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
    <div  style={{
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
          {/* Grid utilaje rapide de pe santier */}
          {(utilajeSantier||[]).length > 0 && (
            <div>
              <label style={S.lbl}>⚡ Utilaje deja pe șantier (click rapid)</label>
              <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:4}}>
                {(utilajeSantier||[]).filter(u => !u.deep_sleep && u.stare !== 'Nefunctional').map(u => (
                  <button key={u.id} onClick={() => { setF(p => ({...p, active_id:u.id})); setUtilajSearch(`${u.marca} ${u.model} ${u.nr_inmatriculare||u.cod_intern||''}`); setShowList(false) }}
                    style={{
                      padding:'5px 10px', border:`2px solid ${f.active_id===u.id ? G.green : G.border}`,
                      borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:600,
                      background: f.active_id===u.id ? G.green+'22' : G.bg,
                      color: f.active_id===u.id ? G.green : G.muted,
                      transition:'all .1s'
                    }}>
                    {u.marca} {u.model}
                    {u.nr_inmatriculare && <span style={{opacity:.6, marginLeft:4}}>{u.nr_inmatriculare}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Utilaj autocomplete (pentru cele din afara santierului) */}
          <div style={{position:'relative'}}>
            <label style={S.lbl}>🔍 Sau caută alt utilaj {f.active_id && <span style={{color:G.green}}>✓</span>}</label>
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

          {/* Mecanic */}
          <div>
            <label style={S.lbl}>🔧 Mecanic responsabil (opțional)</label>
            <select value={f.mecanic_id} onChange={e => setF({...f,mecanic_id:e.target.value})} style={S.input}>
              <option value="">— Fără mecanic alocat —</option>
              {(employees||[]).filter(e => (e.functie||'').toLowerCase().includes('mecanic') || (e.department||'').toLowerCase().includes('logistic')).map(e => (
                <option key={e.id} value={e.id}>{e.name} · {e.functie||e.department}</option>
              ))}
              <option disabled>──────────────</option>
              {(employees||[]).filter(e => !(e.functie||'').toLowerCase().includes('mecanic') && !(e.department||'').toLowerCase().includes('logistic')).map(e => (
                <option key={`all_${e.id}`} value={e.id}>{e.name}</option>
              ))}
            </select>
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


// ══════════════════════════════════════════════════════════
// SECȚIUNE MAȘINI NAVETA PER TURĂ
// ══════════════════════════════════════════════════════════
export function NavetaTura({ proiectId, siteId, dataStart, dataEnd, canWrite, employees, masiniLista }) {
  const [naveta, setNaveta] = useState([])
  const [loading, setLoading] = useState(true)
  const [editNaveta, setEditNaveta] = useState(null)
  const { show, Toast } = useToast()

  const loadNaveta = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data } = await supabase.from('executie_tura_naveta')
        .select(`id, masina_id, sofer_id, observatii, data_start, data_end,
                 logistica_active(id, marca, model, nr_inmatriculare, cod_intern),
                 employees(id, name, functie)`)
        .eq('proiect_id', proiectId)
        .gte('data_end', dataStart)
        .lte('data_start', dataEnd)
        .order('created_at')
      setNaveta(data || [])
    } finally { setLoading(false) }
  }, [proiectId, dataStart, dataEnd])

  useEffect(() => { loadNaveta() }, [loadNaveta])

  const handleDelete = async n => {
    if (!confirm(`Elimini mașina ${n.logistica_active?.nr_inmatriculare} din naveta?`)) return
    const { error } = await supabase.from('executie_tura_naveta').delete().eq('id', n.id)
    if (error) show('Eroare: ' + error.message, 'err')
    else { show('✓ Mașină eliminată'); loadNaveta() }
  }

  return (
    <div style={{marginTop:24}}>
      <div style={{display:'flex', alignItems:'center', gap:14, marginBottom:14}}>
        <div style={{height:1, flex:1, background:G.border}} />
        <div style={{fontSize:14, fontWeight:800, color:G.text}}>🚗 Mașini naveta</div>
        <div style={{height:1, flex:1, background:G.border}} />
        {canWrite && (
          <button onClick={() => setEditNaveta({ proiect_id: proiectId, site_id: siteId, data_start: dataStart, data_end: dataEnd })}
            style={{...S.btn, background:G.blue, color:'#fff', padding:'7px 14px', fontSize:12}}>
            ＋ Adaugă mașină
          </button>
        )}
      </div>

      {loading ? (
        <div style={{textAlign:'center', color:G.muted, fontSize:12, padding:16}}>⏳ Se încarcă...</div>
      ) : naveta.length === 0 ? (
        <div style={{padding:'16px', textAlign:'center', color:G.dim, fontSize:12,
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:8}}>
          🚗 Nicio mașină de naveta adăugată.<br />
          <span style={{fontSize:10}}>Adaugă mașinile care fac naveta în această tură.</span>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {naveta.map(n => {
            const m = n.logistica_active || {}
            const s = n.employees || {}
            return (
              <div key={n.id} style={{
                display:'flex', alignItems:'center', gap:12,
                padding:'10px 14px', background:G.surface,
                border:`1px solid ${G.blue}44`, borderRadius:8, borderLeft:`3px solid ${G.blue}`
              }}>
                <span style={{fontSize:16}}>🚗</span>
                <div style={{flex:1}}>
                  <span style={{fontWeight:700, color:G.text, fontSize:13}}>
                    {m.nr_inmatriculare || m.cod_intern} — {m.marca} {m.model}
                  </span>
                  {s.name && (
                    <span style={{fontSize:11, color:G.blue, marginLeft:10}}>
                      👤 {s.name}
                    </span>
                  )}
                  {n.observatii && <span style={{fontSize:10, color:G.muted, marginLeft:8}}>{n.observatii}</span>}
                </div>
                {canWrite && (
                  <button onClick={() => handleDelete(n)}
                    style={{...S.btn, padding:'3px 8px', fontSize:10, background:G.red+'22', color:G.red, border:`1px solid ${G.red}44`}}>
                    🗑
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editNaveta && (
        <NavetaModal
          item={editNaveta}
          employees={employees||[]}
          masiniLista={masiniLista||[]}
          onClose={() => setEditNaveta(null)}
          onSaved={() => { setEditNaveta(null); loadNaveta(); show('✓ Mașină naveta adăugată') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
      <Toast />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ADAUGĂ MAȘINĂ NAVETA
// ══════════════════════════════════════════════════════════
function NavetaModal({ item, employees, masiniLista, onClose, onSaved, onError }) {
  const [f, setF] = useState({
    proiect_id: item.proiect_id || '',
    site_id:    item.site_id    || '',
    masina_id:  '',
    sofer_id:   '',
    data_start: item.data_start || '',
    data_end:   item.data_end   || '',
    observatii: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!f.masina_id) return onError('Selectează mașina')
    if (!f.data_start || !f.data_end) return onError('Completează fereastra turei')
    setSaving(true)
    const { error } = await supabase.from('executie_tura_naveta').insert({
      proiect_id: Number(f.proiect_id),
      site_id:    f.site_id ? Number(f.site_id) : null,
      masina_id:  Number(f.masina_id),
      sofer_id:   f.sofer_id ? Number(f.sofer_id) : null,
      data_start: f.data_start,
      data_end:   f.data_end,
      observatii: f.observatii.trim() || null,
    })
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <div  style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24
    }}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:440, padding:'22px 26px',
        boxShadow:'0 20px 60px rgba(0,0,0,.5)'
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>🚗 Adaugă mașină naveta</div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          <div>
            <label style={S.lbl}>Mașina *</label>
            <select value={f.masina_id} onChange={e => setF({...f, masina_id:e.target.value})} style={S.input}>
              <option value="">— Selectează mașina —</option>
              {(masiniLista||[]).map(m => (
                <option key={m.id} value={m.id}>
                  {m.nr_inmatriculare||m.cod_intern} — {m.marca} {m.model}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Șofer</label>
            <select value={f.sofer_id} onChange={e => setF({...f, sofer_id:e.target.value})} style={S.input}>
              <option value="">— Fără șofer specificat —</option>
              {(employees||[]).map(e => (
                <option key={e.id} value={e.id}>{e.name}{e.functie ? ` · ${e.functie}` : ''}</option>
              ))}
            </select>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
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
            <label style={S.lbl}>Observații</label>
            <input value={f.observatii} onChange={e => setF({...f,observatii:e.target.value})}
              style={S.input} placeholder="ex: Sediu → Orsova dus-întors" />
          </div>
          <div style={{display:'flex', gap:10}}>
            <button onClick={onClose} style={{...S.btn, flex:1, background:G.border2, color:G.text}}>Anulează</button>
            <button onClick={handleSave} disabled={saving}
              style={{...S.btn, flex:2, background:saving?G.muted:G.blue, color:'#fff', opacity:saving?0.6:1}}>
              {saving ? '⏳...' : '🚗 Adaugă naveta'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL BULK ECHIPĂ — adaugi N oameni dintr-o dată
// ══════════════════════════════════════════════════════════
function EchipaModal({ proiecte, employees, defaultProiectId, defaultStart, defaultEnd, onClose, onSaved, onError }) {
  const [proiectId, setProiectId] = useState(defaultProiectId || '')
  const [echipa, setEchipa] = useState('Echipa 1')
  const [echipaRol, setEchipaRol] = useState('')
  const [dataStart, setDataStart] = useState(defaultStart || '')
  const [dataEnd, setDataEnd] = useState(defaultEnd || '')
  const [search, setSearch] = useState('')
  const [selectati, setSelectati] = useState({}) // { emp_id: { meserie, masina_naveta } }
  const [saving, setSaving] = useState(false)

  const ECHIPE = ['Echipa 1','Echipa 2','Echipa 3','Echipa 4 Izolat','Paza / Mecanic / Sofer','TESA']
  const ROLURI = [{v:'sudura',l:'🔥 Sudură'},{v:'terasamente',l:'⛏️ Terasamente'},{v:'lansare',l:'🚜 Lansare'},{v:'izolare',l:'🧰 Izolare'},{v:'tesa_paza',l:'💼 TESA / Pază'},{v:'paza',l:'🛡 Pază'},{v:'mecanic',l:'🔧 Mecanic'},{v:'alt',l:'Alt rol'}]
  const MESERII = [{v:'deservent_utilaje',l:'🚜 Deserv. utilaje'},{v:'sudor',l:'🔥 Sudor'},{v:'lacatus_mecanic',l:'🔧 Lăcătuș'},{v:'muncitor_izolator',l:'👷 Muncitor'},{v:'tesa_paza',l:'💼 TESA / Pază'},{v:'sofer',l:'🚗 Șofer'},{v:'alt',l:'Alt'}]

  const empFiltrati = useMemo(() => {
    const s = search.toLowerCase()
    const list = s.length > 1
      ? employees.filter(e => e.name.toLowerCase().includes(s) || (e.functie||'').toLowerCase().includes(s))
      : employees
    return list.slice(0, 40)
  }, [employees, search])

  const toggleEmp = id => {
    setSelectati(prev => {
      if (prev[id]) { const n = {...prev}; delete n[id]; return n }
      const emp = employees.find(e => e.id === id)
      const mesAuto = MESERII.find(m => (emp?.functie||'').toLowerCase().includes(m.v.replace('_',' ')))?.v || 'muncitor_izolator'
      return {...prev, [id]: { meserie: mesAuto, masina_naveta: '' }}
    })
  }

  const nrSelectati = Object.keys(selectati).length

  const handleSave = async () => {
    if (!proiectId) return onError('Selectează proiectul')
    if (nrSelectati === 0) return onError('Selectează cel puțin un angajat')
    if (!dataStart || !dataEnd) return onError('Completează fereastra turei')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const rows = Object.entries(selectati).map(([empId, cfg]) => ({
      proiect_id:  Number(proiectId),
      employee_id: Number(empId),
      echipa:      echipa || null,
      echipa_rol:  echipaRol || null,
      meserie:     cfg.meserie || null,
      masina_naveta: cfg.masina_naveta || null,
      data_start:  dataStart,
      data_end:    dataEnd,
      alocat_de:   user?.id,
      updated_at:  new Date().toISOString(),
    }))
    const { error } = await supabase.from('executie_alocari_personal').insert(rows)
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <div  style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.80)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16
    }}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:680, maxHeight:'92vh', overflow:'hidden',
        display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.6)'
      }}>
        {/* Header */}
        <div style={{padding:'18px 22px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>👥 Adaugă echipă în tură</div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        {/* Config echipă */}
        <div style={{padding:'14px 22px', borderBottom:`1px solid ${G.border}`, flexShrink:0}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10}}>
            <div>
              <label style={S.lbl}>Proiect *</label>
              <select value={proiectId} onChange={e => setProiectId(e.target.value)} style={S.input}>
                <option value="">— Selectează —</option>
                {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Echipă</label>
              <select value={echipa} onChange={e => setEchipa(e.target.value)} style={S.input}>
                {ECHIPE.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10}}>
            <div>
              <label style={S.lbl}>Rol echipă</label>
              <select value={echipaRol} onChange={e => setEchipaRol(e.target.value)} style={S.input}>
                <option value="">— Rol —</option>
                {ROLURI.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Start tură *</label>
              <input type="date" value={dataStart} onChange={e => setDataStart(e.target.value)} style={S.input} />
            </div>
            <div>
              <label style={S.lbl}>End tură *</label>
              <input type="date" value={dataEnd} onChange={e => setDataEnd(e.target.value)} style={S.input} />
            </div>
          </div>
          {echipa && echipaRol && (
            <div style={{marginTop:8, padding:'5px 10px', background:G.purple+'11', border:`1px solid ${G.purple}44`, borderRadius:6, fontSize:11, color:G.purple, display:'inline-block'}}>
              👥 {echipa} · {ROLURI.find(r=>r.v===echipaRol)?.l}
            </div>
          )}
        </div>

        {/* Search + Lista angajati */}
        <div style={{padding:'10px 22px 6px', flexShrink:0}}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Caută angajat după nume sau funcție..."
            style={{...S.input, width:'100%'}} />
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6}}>
            <div style={{fontSize:11, color:G.muted}}>{employees.length} angajați · afișați {empFiltrati.length}</div>
            {nrSelectati > 0 && (
              <div style={{fontSize:11, color:G.green, fontWeight:700}}>✓ {nrSelectati} selectați</div>
            )}
          </div>
        </div>

        {/* Lista scrollabila */}
        <div style={{flex:1, overflowY:'auto', padding:'0 22px'}}>
          {empFiltrati.map(emp => {
            const sel = selectati[emp.id]
            return (
              <div key={emp.id} style={{
                display:'flex', alignItems:'center', gap:10, padding:'8px 10px',
                marginBottom:4, borderRadius:8, cursor:'pointer',
                background: sel ? G.green+'11' : G.bg,
                border: `1px solid ${sel ? G.green+'44' : G.border}`,
                transition:'all .1s'
              }} onClick={() => toggleEmp(emp.id)}>
                {/* Checkbox */}
                <div style={{
                  width:18, height:18, borderRadius:4, flexShrink:0,
                  background: sel ? G.green : 'transparent',
                  border: `2px solid ${sel ? G.green : G.border}`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff'
                }}>{sel ? '✓' : ''}</div>

                {/* Nume + functie */}
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600, color:G.text, lineHeight:1.2}}>{emp.name}</div>
                  <div style={{fontSize:10, color:G.muted}}>{emp.functie || emp.department}</div>
                </div>

                {/* Meserie (doar daca selectat) */}
                {sel && (
                  <select value={sel.meserie} onClick={e => e.stopPropagation()}
                    onChange={e => setSelectati(prev => ({...prev, [emp.id]: {...prev[emp.id], meserie: e.target.value}}))}
                    style={{...S.input, width:140, fontSize:11, padding:'4px 6px'}}>
                    {MESERII.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{padding:'14px 22px', borderTop:`1px solid ${G.border}`, flexShrink:0, display:'flex', gap:10}}>
          <button onClick={onClose} style={{...S.btn, flex:1, background:G.border2, color:G.text}}>
            Anulează
          </button>
          <button onClick={handleSave} disabled={saving || nrSelectati === 0}
            style={{...S.btn, flex:2,
              background: nrSelectati > 0 ? G.executie : G.muted,
              color: nrSelectati > 0 ? '#0D1117' : G.dim,
              opacity: saving ? 0.6 : 1, cursor: nrSelectati === 0 ? 'not-allowed' : 'pointer',
              fontWeight:700
            }}>
            {saving ? '⏳ Se salvează...' : nrSelectati > 0 ? `＋ Adaugă ${nrSelectati} ${nrSelectati === 1 ? 'persoană' : 'persoane'} în tură` : '＋ Adaugă echipă în tură'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL BULK UTILAJE — grid multi-select
// ══════════════════════════════════════════════════════════
function UtilajeBulkModal({ siteId, dataStart, dataEnd, utilajeSantier, allUtilaje, employees, onClose, onSaved, onError }) {
  const [selectate, setSelectate] = useState({}) // { activ_id: { mecanic_id, justificare } }
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('santier') // 'santier' | 'altele'

  const nrSelectate = Object.keys(selectate).length

  const utilajeFiltrate = useMemo(() => {
    const src = tab === 'santier' ? (utilajeSantier||[]) : (allUtilaje||[]).filter(u => !(utilajeSantier||[]).find(s => s.id===u.id))
    if (!search.trim()) return src
    const s = search.toLowerCase()
    return src.filter(u => `${u.marca} ${u.model} ${u.nr_inmatriculare||''} ${u.cod_intern||''}`.toLowerCase().includes(s))
  }, [tab, utilajeSantier, allUtilaje, search])

  const toggleUtilaj = id => {
    setSelectate(prev => {
      if (prev[id]) { const n = {...prev}; delete n[id]; return n }
      return {...prev, [id]: { mecanic_id: '', justificare: '' }}
    })
  }

  const handleSave = async () => {
    if (nrSelectate === 0) return onError('Selectează cel puțin un utilaj')
    if (!dataStart || !dataEnd) return onError('Datele turei lipsesc')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const results = await Promise.all(
      Object.entries(selectate).map(([activId, cfg]) =>
        supabase.from('logistica_alocari').insert({
          active_id:   Number(activId),
          site_id:     Number(siteId),
          status:      'aprobata',
          data_start:  dataStart,
          data_end:    dataEnd,
          justificare: cfg.justificare || 'Alocare tură',
          mecanic_id:  cfg.mecanic_id ? Number(cfg.mecanic_id) : null,
          solicitata_de: user?.id,
          aprobata_de:   user?.id,
          data_cerere:   new Date().toISOString(),
          data_decizie:  new Date().toISOString(),
        })
      )
    )
    setSaving(false)
    const eroare = results.find(r => r.error)
    if (eroare) onError(eroare.error.message)
    else onSaved()
  }

  const stareColor = u => {
    if (u.deep_sleep) return G.purple
    if (u.stare === 'Nefunctional') return G.red
    return G.green
  }

  return (
    <div  style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.80)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16
    }}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:720, maxHeight:'92vh', overflow:'hidden',
        display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.6)'
      }}>
        {/* Header */}
        <div style={{padding:'18px 22px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>🚜 Adaugă utilaje în tură</div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        {/* Tabs + Search */}
        <div style={{padding:'10px 22px 6px', borderBottom:`1px solid ${G.border}`, flexShrink:0}}>
          <div style={{display:'flex', gap:8, marginBottom:8}}>
            {[{v:'santier',l:`🏗️ Pe șantier (${(utilajeSantier||[]).length})`},{v:'altele',l:'🔍 Alte utilaje'}].map(t => (
              <button key={t.v} onClick={() => setTab(t.v)}
                style={{...S.btn, padding:'5px 14px', fontSize:12,
                  background: tab===t.v ? G.orange+'33' : G.border2,
                  color: tab===t.v ? G.orange : G.muted,
                  border:`1px solid ${tab===t.v ? G.orange : G.border}`}}>
                {t.l}
              </button>
            ))}
            {nrSelectate > 0 && (
              <div style={{marginLeft:'auto', fontSize:12, color:G.green, fontWeight:700, display:'flex', alignItems:'center'}}>
                ✓ {nrSelectate} selectate
              </div>
            )}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Caută marcă, model, plăcuță, cod intern..."
            style={{...S.input, width:'100%'}} />
        </div>

        {/* Grid utilaje */}
        <div style={{flex:1, overflowY:'auto', padding:'14px 22px'}}>
          {utilajeFiltrate.length === 0 ? (
            <div style={{textAlign:'center', color:G.dim, padding:30, fontSize:12}}>
              {tab === 'santier' ? '🏗️ Niciun utilaj înregistrat pe șantier' : '🔍 Niciun rezultat pentru căutare'}
            </div>
          ) : (
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))', gap:8}}>
              {utilajeFiltrate.map(u => {
                const sel = selectate[u.id]
                const col = stareColor(u)
                return (
                  <div key={u.id}
                    onClick={() => toggleUtilaj(u.id)}
                    style={{
                      padding:'10px 12px', borderRadius:9, cursor:'pointer',
                      background: sel ? col+'22' : G.bg,
                      border: `2px solid ${sel ? col : G.border}`,
                      transition:'all .1s', position:'relative'
                    }}>
                    {sel && (
                      <div style={{position:'absolute', top:6, right:8, width:18, height:18, borderRadius:9, background:col, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#fff', fontWeight:700}}>✓</div>
                    )}
                    <div style={{fontSize:12, fontWeight:700, color:G.text, lineHeight:1.3, paddingRight:sel?20:0}}>
                      {u.marca} {u.model}
                    </div>
                    <div style={{fontSize:10, color:G.muted, marginTop:2}}>
                      {u.nr_inmatriculare || u.cod_intern || '—'}
                    </div>
                    <div style={{fontSize:9, color:col, marginTop:3, fontWeight:600}}>
                      {u.deep_sleep ? '💤 Deep Sleep' : u.stare === 'Nefunctional' ? '🔴 Nefuncțional' : '✅ Funcțional'}
                    </div>
                    {sel && (
                      <div onClick={e => e.stopPropagation()} style={{marginTop:6}}>
                        <select value={sel.mecanic_id}
                          onChange={e => setSelectate(prev => ({...prev, [u.id]: {...prev[u.id], mecanic_id: e.target.value}}))}
                          style={{...S.input, fontSize:10, padding:'3px 5px', width:'100%'}}>
                          <option value="">🔧 Fără mecanic</option>
                          {(employees||[]).filter(e => (e.functie||'').toLowerCase().includes('mecanic')).map(e => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'14px 22px', borderTop:`1px solid ${G.border}`, flexShrink:0, display:'flex', gap:10}}>
          <button onClick={onClose} style={{...S.btn, flex:1, background:G.border2, color:G.text}}>Anulează</button>
          <button onClick={handleSave} disabled={saving || nrSelectate === 0}
            style={{...S.btn, flex:2,
              background: nrSelectate > 0 ? G.orange : G.muted,
              color: nrSelectate > 0 ? '#fff' : G.dim,
              opacity: saving ? 0.6 : 1, cursor: nrSelectate === 0 ? 'not-allowed' : 'pointer',
              fontWeight:700
            }}>
            {saving ? '⏳ Se salvează...' : nrSelectate > 0 ? `🚜 Adaugă ${nrSelectate} utilaj${nrSelectate===1?'':'e'} în tură` : '🚜 Adaugă în tură'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// SECȚIUNE SUBCONTRACTORI PE TURĂ
// ══════════════════════════════════════════════════════════
export function SubcontractoriTura({ proiectId, siteId, dataStart, dataEnd, canWrite }) {
  const [subcont, setSubcont] = useState([])
  const [loading, setLoading] = useState(true)
  const [editSub, setEditSub] = useState(null)
  const { show, Toast } = useToast()

  const load = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data } = await supabase.from('executie_tura_subcontractori')
        .select('*')
        .eq('proiect_id', proiectId)
        .gte('data_end', dataStart)
        .lte('data_start', dataEnd)
        .order('tip').order('firma_text')
      setSubcont(data || [])
    } finally { setLoading(false) }
  }, [proiectId, dataStart, dataEnd])

  useEffect(() => { load() }, [load])

  const handleDelete = async s => {
    if (!confirm(`Elimini ${s.firma_text} din tură?`)) return
    await supabase.from('executie_tura_subcontractori').delete().eq('id', s.id)
    show('✓ Eliminat'); load()
  }

  const prestari = subcont.filter(s => s.tip === 'prestari_servicii')
  const inchiriate = subcont.filter(s => s.tip === 'inchiriat')
  const totalPersoane = subcont.reduce((s, x) => s + (x.nr_persoane || 0), 0)

  return (
    <div style={{ marginTop: 24 }}>
      {/* Separator */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
        <div style={{ height:1, flex:1, background:G.border }} />
        <div style={{ fontSize:14, fontWeight:800, color:G.text }}>
          🤝 Subcontractori{totalPersoane > 0 && <span style={{ fontSize:12, color:G.muted, fontWeight:400, marginLeft:6 }}>· {totalPersoane} persoane externe</span>}
        </div>
        <div style={{ height:1, flex:1, background:G.border }} />
        {canWrite && (
          <button onClick={() => setEditSub({ proiect_id: proiectId, site_id: siteId, data_start: dataStart, data_end: dataEnd })}
            style={{ ...S.btn, background:'#7C3AED', color:'#fff', padding:'7px 14px', fontSize:12 }}>
            ＋ Adaugă firmă
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', color:G.muted, fontSize:12, padding:16 }}>⏳</div>
      ) : subcont.length === 0 ? (
        <div style={{ padding:16, textAlign:'center', color:G.dim, fontSize:12,
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:8 }}>
          🤝 Nicio firmă subcontractată adăugată pe această tură.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

          {/* ÎNCHIRIATE — evidență strictă */}
          {inchiriate.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:G.orange, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 }}>
                🔄 Închiriate ({inchiriate.length})
              </div>
              {inchiriate.map(s => (
                <SubcontractorCard key={s.id} s={s} canWrite={canWrite}
                  onEdit={() => setEditSub(s)} onDelete={() => handleDelete(s)} />
              ))}
            </div>
          )}

          {/* PRESTĂRI SERVICII — informativ */}
          {prestari.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, color:'#7C3AED', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6, marginTop: inchiriate.length > 0 ? 10 : 0 }}>
                📋 Prestări servicii ({prestari.length})
              </div>
              {prestari.map(s => (
                <SubcontractorCard key={s.id} s={s} canWrite={canWrite}
                  onEdit={() => setEditSub(s)} onDelete={() => handleDelete(s)} />
              ))}
            </div>
          )}
        </div>
      )}

      {editSub && (
        <SubcontractorModal
          item={editSub}
          onClose={() => setEditSub(null)}
          onSaved={() => { setEditSub(null); load(); show('✓ Salvat') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
      <Toast />
    </div>
  )
}

function SubcontractorCard({ s, canWrite, onEdit, onDelete }) {
  const isInchiriat = s.tip === 'inchiriat'
  const col = isInchiriat ? G.orange : '#7C3AED'
  const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit' }) : '—'

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
      background:G.surface, border:`1px solid ${col}44`,
      borderLeft:`3px solid ${col}`, borderRadius:8, marginBottom:4
    }}>
      <div style={{ fontSize:20 }}>{isInchiriat ? '🔄' : '📋'}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, fontWeight:700, color:G.text }}>{s.firma_text}</span>
          <span style={{ fontSize:10, padding:'1px 7px', borderRadius:10, fontWeight:700,
            background:col+'22', color:col }}>
            {isInchiriat ? '🔄 Închiriat' : '📋 Prestări servicii'}
          </span>
          {s.nr_persoane && (
            <span style={{ fontSize:11, color:G.muted }}>👷 {s.nr_persoane} pers.</span>
          )}
          {s.meserie && (
            <span style={{ fontSize:11, color:G.muted }}>· {s.meserie}</span>
          )}
          {!s.contract_id && (
            <span style={{ fontSize:10, padding:'1px 6px', borderRadius:10,
              background:G.yellow+'22', color:G.yellow, fontWeight:600 }}>
              ⚠ Contract nelinkat
            </span>
          )}
        </div>
        <div style={{ fontSize:10, color:G.dim, marginTop:2 }}>
          📅 {fmtD(s.data_start)} → {fmtD(s.data_end)}
          {s.observatii && <span style={{ marginLeft:8 }}>· {s.observatii}</span>}
        </div>
      </div>
      {canWrite && (
        <div style={{ display:'flex', gap:4 }}>
          <button onClick={onEdit}
            style={{ ...S.btn, padding:'3px 8px', fontSize:10, background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}44` }}>✏️</button>
          <button onClick={onDelete}
            style={{ ...S.btn, padding:'3px 8px', fontSize:10, background:G.red+'22', color:G.red, border:`1px solid ${G.red}44` }}>🗑</button>
        </div>
      )}
    </div>
  )
}

function SubcontractorModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    firma_text:  item.firma_text  || '',
    tip:         item.tip         || 'prestari_servicii',
    nr_persoane: item.nr_persoane || '',
    meserie:     item.meserie     || '',
    data_start:  item.data_start  || '',
    data_end:    item.data_end    || '',
    observatii:  item.observatii  || '',
  })
  const [saving, setSaving] = useState(false)

  const FIRME_CUNOSCUTE = ['WELDMAG','ARA','ARANEW','EXPCORO','ELSUDMONT','APAZOL']

  const handleSave = async () => {
    if (!f.firma_text.trim()) return onError('Introdu numele firmei')
    if (!f.data_start || !f.data_end) return onError('Completează perioadele')
    setSaving(true)
    const payload = {
      proiect_id:  Number(item.proiect_id),
      site_id:     item.site_id ? Number(item.site_id) : null,
      firma_text:  f.firma_text.trim().toUpperCase(),
      tip:         f.tip,
      nr_persoane: f.nr_persoane ? Number(f.nr_persoane) : null,
      meserie:     f.meserie.trim() || null,
      data_start:  f.data_start,
      data_end:    f.data_end,
      observatii:  f.observatii.trim() || null,
      updated_at:  new Date().toISOString(),
    }
    const res = isNew
      ? await supabase.from('executie_tura_subcontractori').insert(payload)
      : await supabase.from('executie_tura_subcontractori').update(payload).eq('id', item.id)
    setSaving(false)
    if (res.error) onError(res.error.message)
    else onSaved()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:460, padding:'22px 26px', boxShadow:'0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div style={{ fontSize:16, fontWeight:800, color:G.text }}>
            🤝 {isNew ? 'Adaugă firmă subcontractată' : `Editează: ${item.firma_text}`}
          </div>
          <button onClick={onClose} style={{ background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer' }}>×</button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {/* Firma */}
          <div>
            <label style={S.lbl}>Firma *</label>
            <input value={f.firma_text} onChange={e => setF({...f, firma_text:e.target.value})}
              style={S.input} placeholder="ex: WELDMAG" list="firme-list" />
            <datalist id="firme-list">
              {FIRME_CUNOSCUTE.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>

          {/* Tip */}
          <div>
            <label style={S.lbl}>Tip colaborare</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                { v:'prestari_servicii', l:'📋 Prestări servicii', col:'#7C3AED', sub:'WELDMAG / ARA / APAZOL' },
                { v:'inchiriat',         l:'🔄 Închiriat',         col:G.orange,  sub:'ELSUDMONT / EXPCORO' },
              ].map(t => (
                <button key={t.v} onClick={() => setF({...f, tip:t.v})}
                  style={{ padding:'10px 12px', border:`2px solid ${f.tip===t.v ? t.col : G.border}`,
                    borderRadius:8, cursor:'pointer', textAlign:'left',
                    background: f.tip===t.v ? t.col+'22' : G.bg,
                    color: f.tip===t.v ? t.col : G.muted }}>
                  <div style={{ fontSize:12, fontWeight:700 }}>{t.l}</div>
                  <div style={{ fontSize:10, opacity:0.7, marginTop:2 }}>{t.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={S.lbl}>Nr. persoane</label>
              <input type="number" value={f.nr_persoane} onChange={e => setF({...f, nr_persoane:e.target.value})}
                style={S.input} placeholder="ex: 11" min="1" />
            </div>
            <div>
              <label style={S.lbl}>Meserie / Activitate</label>
              <input value={f.meserie} onChange={e => setF({...f, meserie:e.target.value})}
                style={S.input} placeholder="ex: Sudori" />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={S.lbl}>Start *</label>
              <input type="date" value={f.data_start} onChange={e => setF({...f, data_start:e.target.value})} style={S.input} />
            </div>
            <div>
              <label style={S.lbl}>End *</label>
              <input type="date" value={f.data_end} onChange={e => setF({...f, data_end:e.target.value})} style={S.input} />
            </div>
          </div>

          <div>
            <label style={S.lbl}>Observații</label>
            <input value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})}
              style={S.input} placeholder="ex: Finalizeaza racord grup 57" />
          </div>

          {!item.contract_id && (
            <div style={{ padding:'8px 12px', background:G.yellow+'11', border:`1px solid ${G.yellow}44`,
              borderRadius:6, fontSize:11, color:G.yellow }}>
              ⚠ Contract nelinkat — se poate lega ulterior din Contracte Comerciale când e adăugat.
            </div>
          )}

          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button onClick={onClose} style={{ ...S.btn, flex:1, background:G.border2, color:G.text }}>Anulează</button>
            <button onClick={handleSave} disabled={saving}
              style={{ ...S.btn, flex:2, background:saving?G.muted:'#7C3AED', color:'#fff', opacity:saving?0.6:1 }}>
              {saving ? '⏳...' : isNew ? '＋ Adaugă firmă' : '💾 Salvează'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// SECȚIUNE ACTIVITĂȚI PROPUSE PE TURĂ
// ══════════════════════════════════════════════════════════
export function ActivitatiTura({ proiectId, siteId, dataStart, dataEnd, canWrite }) {
  const [activitati, setActivitati] = useState([])
  const [loading, setLoading] = useState(true)
  const [editAct, setEditAct] = useState(null)
  const { show, Toast } = useToast()

  const load = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data } = await supabase.from('executie_tura_activitati')
        .select('*')
        .eq('proiect_id', proiectId)
        .gte('data_end', dataStart)
        .lte('data_start', dataEnd)
        .order('nr_ordine')
      setActivitati(data || [])
    } finally { setLoading(false) }
  }, [proiectId, dataStart, dataEnd])

  useEffect(() => { load() }, [load])

  const handleDelete = async a => {
    if (!confirm(`Ștergi activitatea: "${a.descriere}"?`)) return
    await supabase.from('executie_tura_activitati').delete().eq('id', a.id)
    show('✓ Șters'); load()
  }

  const STATUS_CFG = {
    planificat: { col:'#58A6FF', icon:'📋' },
    in_lucru:   { col:'#D29922', icon:'🔧' },
    realizat:   { col:'#2EA043', icon:'✅' },
    anulat:     { col:'#F85149', icon:'❌' },
  }

  const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'short' }) : null

  return (
    <div style={{ marginTop:24 }}>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
        <div style={{ height:1, flex:1, background:G.border }} />
        <div style={{ fontSize:14, fontWeight:800, color:G.text }}>
          📋 Activități propuse
          <span style={{ fontSize:11, color:G.muted, fontWeight:400, marginLeft:6 }}>
            {activitati.length > 0 && `· ${activitati.filter(a=>a.status==='realizat').length}/${activitati.length} realizate`}
          </span>
        </div>
        <div style={{ height:1, flex:1, background:G.border }} />
        {canWrite && (
          <button onClick={() => setEditAct({ proiect_id:proiectId, site_id:siteId, data_start:dataStart, data_end:dataEnd, nr_ordine: activitati.length + 1 })}
            style={{ ...S.btn, background:G.blue, color:'#fff', padding:'7px 14px', fontSize:12 }}>
            ＋ Adaugă activitate
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign:'center', color:G.muted, fontSize:12, padding:16 }}>⏳</div>
      ) : activitati.length === 0 ? (
        <div style={{ padding:16, textAlign:'center', color:G.dim, fontSize:12,
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:8 }}>
          📋 Nicio activitate planificată.<br/>
          <span style={{ fontSize:10 }}>Adaugă activitățile propuse pentru această tură.</span>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {activitati.map((a, i) => {
            const sc = STATUS_CFG[a.status] || STATUS_CFG.planificat
            return (
              <div key={a.id} style={{
                display:'flex', alignItems:'center', gap:12, padding:'9px 14px',
                background:G.surface, border:`1px solid ${G.border}`,
                borderLeft:`3px solid ${sc.col}`, borderRadius:8
              }}>
                <div style={{ width:22, height:22, borderRadius:4, background:sc.col+'22',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:11, fontWeight:800, color:sc.col, flexShrink:0 }}>
                  {a.nr_ordine}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:13, color:G.text, fontWeight:500 }}>{a.descriere}</span>
                  <div style={{ fontSize:10, color:G.muted, marginTop:1, display:'flex', gap:8, flexWrap:'wrap' }}>
                    {a.data_start_act && a.data_end_act && (
                      <span>📅 {fmtD(a.data_start_act)}{a.data_start_act !== a.data_end_act ? ` → ${fmtD(a.data_end_act)}` : ''}</span>
                    )}
                    {a.responsabil && <span>👤 {a.responsabil}</span>}
                    {a.observatii && <span>· {a.observatii}</span>}
                  </div>
                </div>
                <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:700,
                  background:sc.col+'22', color:sc.col, whiteSpace:'nowrap' }}>
                  {sc.icon} {a.status.replace('_',' ')}
                </span>
                {canWrite && (
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => setEditAct(a)}
                      style={{ ...S.btn, padding:'3px 7px', fontSize:10, background:G.blue+'22', color:G.blue, border:`1px solid ${G.blue}44` }}>✏️</button>
                    <button onClick={() => handleDelete(a)}
                      style={{ ...S.btn, padding:'3px 7px', fontSize:10, background:G.red+'22', color:G.red, border:`1px solid ${G.red}44` }}>🗑</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editAct && (
        <ActivitateModal
          item={editAct}
          onClose={() => setEditAct(null)}
          onSaved={() => { setEditAct(null); load(); show('✓ Salvat') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
      <Toast />
    </div>
  )
}

function ActivitateModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    descriere:     item.descriere     || '',
    nr_ordine:     item.nr_ordine     || 1,
    data_start_act:item.data_start_act|| item.data_start || '',
    data_end_act:  item.data_end_act  || item.data_end   || '',
    responsabil:   item.responsabil   || '',
    status:        item.status        || 'planificat',
    observatii:    item.observatii    || '',
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!f.descriere.trim()) return onError('Completează descrierea')
    setSaving(true)
    const payload = {
      proiect_id:    Number(item.proiect_id),
      site_id:       item.site_id ? Number(item.site_id) : null,
      data_start:    item.data_start,
      data_end:      item.data_end,
      nr_ordine:     Number(f.nr_ordine) || 1,
      descriere:     f.descriere.trim(),
      data_start_act:f.data_start_act || null,
      data_end_act:  f.data_end_act   || null,
      responsabil:   f.responsabil.trim() || null,
      status:        f.status,
      observatii:    f.observatii.trim() || null,
    }
    const res = isNew
      ? await supabase.from('executie_tura_activitati').insert(payload)
      : await supabase.from('executie_tura_activitati').update(payload).eq('id', item.id)
    setSaving(false)
    if (res.error) onError(res.error.message)
    else onSaved()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:480, padding:'22px 26px', boxShadow:'0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <div style={{ fontSize:16, fontWeight:800, color:G.text }}>
            📋 {isNew ? 'Adaugă activitate' : 'Editează activitate'}
          </div>
          <button onClick={onClose} style={{ background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer' }}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'60px 1fr', gap:10 }}>
            <div>
              <label style={S.lbl}>Nr.</label>
              <input type="number" value={f.nr_ordine} onChange={e=>setF({...f,nr_ordine:e.target.value})} style={S.input} min="1"/>
            </div>
            <div>
              <label style={S.lbl}>Descriere *</label>
              <input value={f.descriere} onChange={e=>setF({...f,descriere:e.target.value})} style={S.input} placeholder="ex: Suduri cuplari DN500"/>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={S.lbl}>Data start activitate</label>
              <input type="date" value={f.data_start_act} onChange={e=>setF({...f,data_start_act:e.target.value})} style={S.input}/>
            </div>
            <div>
              <label style={S.lbl}>Data end activitate</label>
              <input type="date" value={f.data_end_act} onChange={e=>setF({...f,data_end_act:e.target.value})} style={S.input}/>
            </div>
          </div>
          <div>
            <label style={S.lbl}>Responsabil</label>
            <input value={f.responsabil} onChange={e=>setF({...f,responsabil:e.target.value})} style={S.input} placeholder="ex: MITITELU P / WELDMAG"/>
          </div>
          <div>
            <label style={S.lbl}>Status</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
              {[{v:'planificat',l:'📋 Plan'},{v:'in_lucru',l:'🔧 Lucru'},{v:'realizat',l:'✅ Gata'},{v:'anulat',l:'❌ Anulat'}].map(s=>(
                <button key={s.v} onClick={()=>setF({...f,status:s.v})}
                  style={{ padding:'7px 4px', border:`2px solid ${f.status===s.v?G.blue:G.border}`,
                    borderRadius:7, cursor:'pointer', fontSize:10, fontWeight:700,
                    background:f.status===s.v?G.blue+'22':G.bg, color:f.status===s.v?G.blue:G.muted }}>
                  {s.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={S.lbl}>Observații</label>
            <input value={f.observatii} onChange={e=>setF({...f,observatii:e.target.value})} style={S.input} placeholder="detalii suplimentare"/>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={{ ...S.btn, flex:1, background:G.border2, color:G.text }}>Anulează</button>
            <button onClick={handleSave} disabled={saving}
              style={{ ...S.btn, flex:2, background:saving?G.muted:G.blue, color:'#fff', opacity:saving?0.6:1 }}>
              {saving?'⏳...':isNew?'＋ Adaugă':'💾 Salvează'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ARHIVĂ TURE
// ══════════════════════════════════════════════════════════
function ArhivaModal({ proiectId, proiecte, onClose, onSelectTura }) {
  const [ture, setTure] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newTura, setNewTura] = useState({ titlu:'', data_start:'', data_end:'', status:'activa' })
  const { show, Toast } = useToast()

  const proiect = proiecte.find(p => String(p.id) === String(proiectId))

  useEffect(() => {
    if (!proiectId) return
    setLoading(true)
    supabase.from('executie_ture').select('*')
      .eq('proiect_id', proiectId)
      .order('data_start', { ascending: false })
      .then(({ data }) => { setTure(data || []); setLoading(false) })
  }, [proiectId])

  const handleFinalizare = async (t) => {
    const nextStatus = t.status === 'activa' ? 'finalizata' : t.status === 'finalizata' ? 'arhivata' : 'activa'
    await supabase.from('executie_ture').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', t.id)
    setTure(prev => prev.map(x => x.id === t.id ? { ...x, status: nextStatus } : x))
    show(`✓ Tură → ${nextStatus}`)
  }

  const handleCreate = async () => {
    if (!newTura.data_start || !newTura.data_end) return show('Completează datele', 'err')
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const titlu = newTura.titlu || `Tură ${new Date(newTura.data_start).toLocaleDateString('ro-RO',{day:'2-digit',month:'short'})} – ${new Date(newTura.data_end).toLocaleDateString('ro-RO',{day:'2-digit',month:'short',year:'numeric'})}`
    const { data, error } = await supabase.from('executie_ture').upsert({
      proiect_id: Number(proiectId),
      data_start: newTura.data_start, data_end: newTura.data_end,
      titlu, status: 'activa', creat_de: user?.id, updated_at: new Date().toISOString()
    }, { onConflict: 'proiect_id,data_start,data_end' }).select().single()
    setSaving(false)
    if (error) show('Eroare: ' + error.message, 'err')
    else { setTure(prev => [data, ...prev.filter(t => t.id !== data.id)]); setNewTura({ titlu:'', data_start:'', data_end:'', status:'activa' }); show('✓ Tură înregistrată') }
  }

  const STATUS = { activa: { col:'#58A6FF', icon:'🔵', l:'Activă' }, finalizata: { col:'#2EA043', icon:'✅', l:'Finalizată' }, arhivata: { col:'#6E7681', icon:'📦', l:'Arhivată' } }
  const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO',{day:'2-digit',month:'short',year:'2-digit'}) : '—'

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.80)', zIndex:1020,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:620, maxHeight:'90vh', overflow:'hidden',
        display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.6)' }}>
        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:G.text }}>📁 Arhivă ture — {proiect?.cod_intern}</div>
            <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>Click pe o tură pentru a o deschide</div>
          </div>
          <button onClick={onClose} style={{ background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer' }}>×</button>
        </div>

        {/* Creare tură nouă */}
        <div style={{ padding:'12px 22px', borderBottom:`1px solid ${G.border}`, flexShrink:0, background:G.bg }}>
          <div style={{ fontSize:11, fontWeight:700, color:G.muted, marginBottom:8 }}>＋ ÎNREGISTREAZĂ TURĂ NOUĂ</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8, alignItems:'end' }}>
            <div>
              <label style={{ fontSize:10, color:G.dim, display:'block', marginBottom:3 }}>Start</label>
              <input type="date" value={newTura.data_start} onChange={e => setNewTura(n=>({...n,data_start:e.target.value}))} style={S.input} />
            </div>
            <div>
              <label style={{ fontSize:10, color:G.dim, display:'block', marginBottom:3 }}>End</label>
              <input type="date" value={newTura.data_end} onChange={e => setNewTura(n=>({...n,data_end:e.target.value}))} style={S.input} />
            </div>
            <div>
              <label style={{ fontSize:10, color:G.dim, display:'block', marginBottom:3 }}>Titlu (opțional)</label>
              <input value={newTura.titlu} onChange={e => setNewTura(n=>({...n,titlu:e.target.value}))} style={S.input} placeholder="ex: Tură specială" />
            </div>
            <button onClick={handleCreate} disabled={saving}
              style={{ ...S.btn, background:G.executie, color:'#0D1117', fontWeight:700, padding:'8px 14px', whiteSpace:'nowrap' }}>
              {saving ? '⏳' : '＋ Salvează'}
            </button>
          </div>
        </div>

        {/* Lista ture */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px 22px' }}>
          {loading ? (
            <div style={{ textAlign:'center', color:G.muted, padding:30 }}>⏳ Se încarcă...</div>
          ) : ture.length === 0 ? (
            <div style={{ textAlign:'center', color:G.dim, padding:30, fontSize:12 }}>
              📁 Nicio tură înregistrată. Adaugă prima tură sus.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {ture.map(t => {
                const sc = STATUS[t.status] || STATUS.activa
                const zile = Math.round((new Date(t.data_end) - new Date(t.data_start))/(1000*60*60*24)) + 1
                return (
                  <div key={t.id} style={{
                    display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
                    background:G.bg, border:`1px solid ${sc.col}44`,
                    borderLeft:`3px solid ${sc.col}`, borderRadius:8, cursor:'pointer',
                  }}
                    onClick={() => onSelectTura(t)}>
                    <div style={{ fontSize:18 }}>{sc.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:G.text }}>{t.titlu || `Tură ${fmtD(t.data_start)} – ${fmtD(t.data_end)}`}</div>
                      <div style={{ fontSize:10, color:G.muted, marginTop:1 }}>
                        📅 {fmtD(t.data_start)} → {fmtD(t.data_end)} · {zile} zile
                      </div>
                    </div>
                    <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:700,
                      background:sc.col+'22', color:sc.col }}>{sc.l}</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleFinalizare(t) }}
                      style={{ ...S.btn, padding:'3px 8px', fontSize:9, background:G.border2, color:G.muted,
                        border:`1px solid ${G.border}`, whiteSpace:'nowrap' }}>
                      {t.status==='activa'?'✅ Finalizează':t.status==='finalizata'?'📦 Arhivează':'↺ Reactivează'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <Toast />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// EXPORT EXCEL — format similar cu Excel-urile Gazpet
// ══════════════════════════════════════════════════════════
async function exportTuraExcel({ proiectId, dataStart, dataEnd, alocari, proiecte }) {
  if (!proiectId || !dataStart) { alert('Selectează un proiect și o perioadă'); return }

  const proiect = proiecte.find(p => String(p.id) === String(proiectId))
  const titlu = proiect?.cod_intern || 'SANTIER'

  const [subRes, actRes, navRes, utilRes] = await Promise.all([
    supabase.from('executie_tura_subcontractori').select('*')
      .eq('proiect_id', proiectId).lte('data_start', dataEnd).gte('data_end', dataStart).order('tip'),
    supabase.from('executie_tura_activitati').select('*')
      .eq('proiect_id', proiectId).lte('data_start', dataEnd).gte('data_end', dataStart).order('nr_ordine'),
    supabase.from('executie_tura_naveta').select('*, logistica_active(marca,model,nr_inmatriculare), employees(name)')
      .eq('proiect_id', proiectId).lte('data_start', dataEnd).gte('data_end', dataStart),
    supabase.from('logistica_alocari').select('*, logistica_active(marca,model,nr_inmatriculare,stare,logistica_categorii(tip))')
      .eq('site_id', proiect?.site_id || 0)
      .in('status',['aprobata','activa']).lte('data_start', dataEnd).gte('data_end', dataStart),
  ])

  const subcont   = subRes.data  || []
  const activitati= actRes.data  || []
  const naveta    = navRes.data  || []
  const utilaje   = utilRes.data || []

  const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO') : ''

  // ─── STILURI ───────────────────────────────────────────
  const ALBASTRU  = '1F3C6E'
  const ALB       = 'FFFFFF'
  const GRI_DSCH  = 'F2F2F2'
  const GRI_MED   = 'D9D9D9'
  const PORTOCALIU= 'E8A020'
  const VERDE     = '2E7D32'

  const border_thin = {
    top:    { style:'thin', color:{ rgb:'CCCCCC' } },
    bottom: { style:'thin', color:{ rgb:'CCCCCC' } },
    left:   { style:'thin', color:{ rgb:'CCCCCC' } },
    right:  { style:'thin', color:{ rgb:'CCCCCC' } },
  }

  const S = {
    titlu:   { font:{ bold:true, sz:16, color:{rgb:ALB} },     fill:{ fgColor:{rgb:ALBASTRU} }, alignment:{ horizontal:'center', vertical:'center' } },
    subtitlu:{ font:{ bold:true, sz:11, color:{rgb:ALB} },     fill:{ fgColor:{rgb:ALBASTRU} }, alignment:{ horizontal:'center', vertical:'center' } },
    sectiune:{ font:{ bold:true, sz:11, color:{rgb:ALB} },     fill:{ fgColor:{rgb:'2E4A7A'} }, alignment:{ vertical:'center' } },
    col_hdr: { font:{ bold:true, sz:10, color:{rgb:'333333'} },fill:{ fgColor:{rgb:GRI_MED} },  border: border_thin, alignment:{ horizontal:'center' } },
    data_row:{ font:{ sz:10 },                                  fill:{ fgColor:{rgb:ALB} },     border: border_thin },
    data_alt:{ font:{ sz:10 },                                  fill:{ fgColor:{rgb:GRI_DSCH} },border: border_thin },
    bold_row:{ font:{ bold:true, sz:10 },                       fill:{ fgColor:{rgb:'FFF8E1'} },border: border_thin },
    total:   { font:{ bold:true, sz:10, color:{rgb:'1F3C6E'} },fill:{ fgColor:{rgb:GRI_MED} },  border: border_thin },
    nr:      { font:{ bold:true, sz:10, color:{rgb:ALBASTRU} },fill:{ fgColor:{rgb:GRI_DSCH} }, border: border_thin, alignment:{ horizontal:'center' } },
    inchiriat:{ font:{ bold:true, sz:10, color:{rgb:'FFFFFF'}}, fill:{ fgColor:{rgb:'D46B00'} }, border: border_thin },
  }

  const ws_data = []
  const merges  = []  // {s:{r,c}, e:{r,c}}
  const rowStyles = {} // { rowIndex: [col0_style, col1_style, ...] }

  const addRow = (cells, styles) => {
    ws_data.push(cells)
    if (styles) rowStyles[ws_data.length - 1] = styles
    return ws_data.length - 1
  }
  const addMerge = (r, c1, c2) => merges.push({ s:{r,c:c1}, e:{r,c:c2} })

  const NCOLS = 6

  // ─── TITLU ───────────────────────────────────────────
  const r0 = addRow([titlu,'','','','',''], Array(NCOLS).fill(S.titlu))
  addMerge(r0, 0, NCOLS-1)

  const r1 = addRow([`PROGRAM LUCRU TURĂ  ${fmtD(dataStart)} – ${fmtD(dataEnd)}`,'','','','',''], Array(NCOLS).fill(S.subtitlu))
  addMerge(r1, 0, NCOLS-1)

  addRow([]) // spatiu

  const meserieLabel = {
    deservent_utilaje:'Deservent utilaje', sudor:'Sudor', lacatus_mecanic:'Lăcătuș mecanic',
    muncitor_izolator:'Muncitor/Izolator', tesa_paza:'TESA/Pază', sofer:'Șofer', alt:'Alt'
  }

  // ─── PERSONAL GAZPET ─────────────────────────────────
  const rPH = addRow(['PERSONAL GAZPET INSTAL','','','','',''], Array(NCOLS).fill(S.sectiune))
  addMerge(rPH, 0, NCOLS-1)

  addRow(['Nr.','NUME','FUNCȚIE','ECHIPĂ','MESERIE','PERIOADĂ'],
    [S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr])

  alocari.forEach((a, i) => {
    const st = i % 2 === 0 ? S.data_row : S.data_alt
    addRow([i+1, a.employee_name||'', a.functie||'', a.echipa||'', meserieLabel[a.meserie]||a.meserie||'', `${fmtD(a.data_start)} → ${fmtD(a.data_end)}`],
      [S.nr, st, st, st, st, st])
  })
  const rT1 = addRow([`TOTAL: ${alocari.length} persoane`,'','','','',''], Array(NCOLS).fill(S.total))
  addMerge(rT1, 0, NCOLS-1)
  addRow([])

  // ─── SUBCONTRACTORI ───────────────────────────────────
  if (subcont.length > 0) {
    const rSH = addRow(['SUBCONTRACTORI / FIRME EXTERNE','','','','',''], Array(NCOLS).fill(S.sectiune))
    addMerge(rSH, 0, NCOLS-1)
    addRow(['Nr.','FIRMĂ','','TIP','PERSOANE','MESERIE'],
      [S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr])
    subcont.forEach((s, i) => {
      const isInch = s.tip === 'inchiriat'
      const st = isInch ? S.inchiriat : (i%2===0 ? S.data_row : S.data_alt)
      addRow([i+1, s.firma_text,'', isInch?'🔄 Închiriat':'📋 Prestări servicii', s.nr_persoane||'', s.meserie||''],
        [S.nr, st, st, st, st, st])
    })
    const totalExt = subcont.reduce((acc,s) => acc+(s.nr_persoane||0), 0)
    const rT2 = addRow([`TOTAL EXTERN: ${totalExt} persoane`,'','','','',''], Array(NCOLS).fill(S.total))
    addMerge(rT2, 0, NCOLS-1)
    addRow([])
  }

  // ─── UTILAJE ──────────────────────────────────────────
  if (utilaje.length > 0) {
    const rUH = addRow(['UTILAJE PE TURĂ','','','','',''], Array(NCOLS).fill(S.sectiune))
    addMerge(rUH, 0, NCOLS-1)
    addRow(['Nr.','UTILAJ','COD INTERN','CATEGORIE','STATUS',''],
      [S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr])
    utilaje.forEach((u, i) => {
      const a = u.logistica_active || {}
      const st = i%2===0 ? S.data_row : S.data_alt
      addRow([i+1, `${a.marca||''} ${a.model||''}`.trim(), a.nr_inmatriculare||'', a.logistica_categorii?.tip||'', a.stare||'', ''],
        [S.nr, st, st, st, st, st])
    })
    addRow([])
  }

  // ─── MAȘINI NAVETA ────────────────────────────────────
  if (naveta.length > 0) {
    const rNH = addRow(['MAȘINI NAVETA','','ȘOFER','','',''], Array(NCOLS).fill(S.sectiune))
    addMerge(rNH, 0, 1); addMerge(rNH, 2, NCOLS-1)
    addRow(['Nr.','MAȘINĂ (plăcuță — marcă model)','ȘOFER','','',''],
      [S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr])
    naveta.forEach((n, i) => {
      const m = n.logistica_active || {}
      const st = i%2===0 ? S.data_row : S.data_alt
      addRow([i+1, `${m.nr_inmatriculare||''} — ${m.marca||''} ${m.model||''}`.trim(), n.employees?.name||'','','',''],
        [S.nr, st, st, st, st, st])
    })
    addRow([])
  }

  // ─── ACTIVITĂȚI PROPUSE ───────────────────────────────
  if (activitati.length > 0) {
    const rAH = addRow(['ACTIVITĂȚI PROPUSE PENTRU PERIOADĂ','','','','',''], Array(NCOLS).fill(S.sectiune))
    addMerge(rAH, 0, NCOLS-1)
    addRow(['Nr.','DESCRIERE ACTIVITATE','','DATA START → END','','RESPONSABIL'],
      [S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr,S.col_hdr])
    activitati.forEach(a => {
      const date = a.data_start_act
        ? `${fmtD(a.data_start_act)}${a.data_end_act !== a.data_start_act ? ` → ${fmtD(a.data_end_act)}` : ''}`
        : ''
      addRow([a.nr_ordine, a.descriere,'', date,'', a.responsabil||''],
        [S.nr, S.bold_row, S.bold_row, S.bold_row, S.bold_row, S.bold_row])
    })
  }

  // ─── BUILD SHEET ──────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(ws_data)
  ws['!cols'] = [{wch:5},{wch:38},{wch:22},{wch:22},{wch:16},{wch:22}]
  ws['!rows'] = [ {hpt:24}, {hpt:18} ]  // titlu + subtitlu mai inalte
  ws['!merges'] = merges

  // Aplica stiluri celula cu celula
  Object.entries(rowStyles).forEach(([rowIdx, styles]) => {
    styles.forEach((s, colIdx) => {
      if (!s) return
      const addr = XLSX.utils.encode_cell({ r: Number(rowIdx), c: colIdx })
      if (!ws[addr]) ws[addr] = { t:'s', v:'' }
      ws[addr].s = s
    })
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Program Tură')
  XLSX.writeFile(wb, `Program_Tura_${titlu}_${dataStart.replace(/-/g,'')}_${dataEnd.replace(/-/g,'')}.xlsx`)
}
