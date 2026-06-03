// ════════════════════════════════════════════════════════════════
// TabSituatiiPlata.jsx — Modul Execuție · Situații de Plată
// 02.06.2026
//
// Features:
// - Selector proiect
// - Timeline SL1→SL6 cu status vizual
// - KPI: total facturate, în pregătire, valoare bază vs ajustată
// - Tabel detaliat CRUD
// - Coeficient ajustare (conf OUG 97 / AA)
// - Badge ⚠️ ajustare fără Act Adițional + modal completare AA
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'

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

const STATUS_SL = {
  in_pregatire: { label:'În pregătire', color:G.muted,   bg:G.border2,       icon:'📝' },
  depusa:       { label:'Depusă',       color:G.yellow,  bg:G.yellow+'22',   icon:'📤' },
  aprobata:     { label:'Aprobată',     color:G.blue,    bg:G.blue+'22',     icon:'✅' },
  facturata:    { label:'Facturată',    color:G.green,   bg:G.greenBg+'44',  icon:'🧾' },
  incasata:     { label:'Încasată',     color:G.teal,    bg:G.teal+'22',     icon:'💰' },
  respinsa:     { label:'Respinsă',     color:G.red,     bg:G.red+'22',      icon:'❌' },
}

const TIP_SL = {
  situatie_plata: { label:'Situație plată', icon:'📊' },
  ncs:            { label:'NCS',             icon:'➕' },
  act_aditional:  { label:'Act adițional',   icon:'📋' },
  avans:          { label:'Avans',           icon:'💵' },
}

const LUNI = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec']

const fmtLei = v => {
  if (!v && v !== 0) return '—'
  return new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON', maximumFractionDigits:0 }).format(v)
}
const fmtDate = d => d ? new Date(d).toLocaleDateString('ro-RO', {day:'2-digit', month:'short', year:'numeric'}) : '—'

function useToast() {
  const [t, setT] = useState(null)
  const show = (msg, kind='ok') => { setT({msg,kind}); setTimeout(()=>setT(null),3500) }
  const Toast = () => t ? (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background:t.kind==='err'?G.red:G.greenBg, color:'#fff',
      borderRadius:8, fontWeight:600, fontSize:13, zIndex:10000,
    }}>{t.msg}</div>
  ) : null
  return { show, Toast }
}

// ══════════════════════════════════════════════════════════
// MODAL ACT ADIȚIONAL
// ══════════════════════════════════════════════════════════
function AAModal({ sl, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    act_aditional_nr:   sl.act_aditional_nr   || '',
    act_aditional_data: sl.act_aditional_data  || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSave = async () => {
    if (!form.act_aditional_nr.trim()) { showToast('Numărul AA este obligatoriu', 'err'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('executie_situatii_plata')
        .update({
          act_aditional_nr:   form.act_aditional_nr.trim().toUpperCase(),
          act_aditional_data: form.act_aditional_data || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sl.id)
      if (error) throw error
      showToast(`Act Adițional ${form.act_aditional_nr} salvat! ✅`, 'ok')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally { setSaving(false) }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1020,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.orange}`, borderRadius:14,
        width:'100%', maxWidth:420,
      }}>
        <div style={{padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:15, fontWeight:700}}>⚠️ Act Adițional — {sl.nr_situatie}</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Ajustare inflație: <span style={{color:G.orange, fontWeight:600}}>{fmtLei(sl.valoare_ajustare_lei)}</span> neacoperită
            </div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'18px 20px', display:'flex', flexDirection:'column', gap:12}}>
          <div>
            <label style={S.label}>Număr Act Adițional *</label>
            <input value={form.act_aditional_nr} onChange={e=>set('act_aditional_nr',e.target.value)}
              style={S.input} placeholder="ex: AA1, AA2" autoFocus />
          </div>
          <div>
            <label style={S.label}>Data semnării</label>
            <input type="date" value={form.act_aditional_data} onChange={e=>set('act_aditional_data',e.target.value)} style={S.input} />
          </div>
          <div style={{
            background:G.orange+'11', border:`1px solid ${G.orange}33`,
            borderRadius:8, padding:'10px 12px', fontSize:12, color:G.muted,
          }}>
            După salvare, alerta dispare automat pentru <strong style={{color:G.text}}>{sl.nr_situatie}</strong>.
          </div>
        </div>
        <div style={{padding:'12px 20px', borderTop:`1px solid ${G.border}`, display:'flex', gap:10, justifyContent:'flex-end', background:G.bg, borderRadius:'0 0 14px 14px'}}>
          <button onClick={onClose} style={{padding:'9px 16px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer', fontSize:13}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'9px 18px', background:saving?G.muted:G.orange, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:13, cursor:saving?'not-allowed':'pointer', fontWeight:700,
          }}>{saving ? 'Se salvează...' : '✅ Salvează AA'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL ADAUGARE / EDITARE
// ══════════════════════════════════════════════════════════
function SLModal({ item, proiectId, onClose, onSaved, showToast }) {
  const isNew = !item?.id
  const [form, setForm] = useState({
    nr_situatie:        item?.nr_situatie || '',
    tip:                item?.tip || 'situatie_plata',
    luna:               item?.luna || '',
    an:                 item?.an || new Date().getFullYear(),
    data_depunere:      item?.data_depunere || '',
    valoare_baza_lei:   item?.valoare_baza_lei || '',
    coeficient_ajustare: item?.coeficient_ajustare || '1.000000',
    status:             item?.status || 'in_pregatire',
    nr_factura:         item?.nr_factura || '',
    data_factura:       item?.data_factura || '',
    observatii:         item?.observatii || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const valAjustata = useMemo(() => {
    const b = parseFloat(form.valoare_baza_lei)
    const c = parseFloat(form.coeficient_ajustare)
    if (isNaN(b) || isNaN(c)) return null
    return Math.round(b * c)
  }, [form.valoare_baza_lei, form.coeficient_ajustare])

  const handleSave = async () => {
    if (!form.nr_situatie.trim()) { showToast('Numărul situației este obligatoriu', 'err'); return }
    setSaving(true)
    try {
      const payload = {
        proiect_id:          proiectId,
        nr_situatie:         form.nr_situatie.trim().toUpperCase(),
        tip:                 form.tip,
        luna:                form.luna !== '' ? parseInt(form.luna) : null,
        an:                  form.an ? parseInt(form.an) : null,
        data_depunere:       form.data_depunere || null,
        valoare_baza_lei:    form.valoare_baza_lei !== '' ? parseFloat(form.valoare_baza_lei) : null,
        coeficient_ajustare: parseFloat(form.coeficient_ajustare) || 1,
        status:              form.status,
        nr_factura:          form.nr_factura.trim() || null,
        data_factura:        form.data_factura || null,
        observatii:          form.observatii.trim() || null,
        updated_at:          new Date().toISOString(),
      }
      let error
      if (isNew) {
        ({ error } = await supabase.from('executie_situatii_plata').insert(payload))
      } else {
        ({ error } = await supabase.from('executie_situatii_plata').update(payload).eq('id', item.id))
      }
      if (error) throw error
      showToast(isNew ? 'Situație adăugată!' : 'Situație actualizată!', 'ok')
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
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:560, maxHeight:'88vh', overflow:'auto',
      }}>
        <div style={{padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{fontSize:16, fontWeight:700}}>{isNew ? '＋ Situație nouă' : `✏️ ${item.nr_situatie}`}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        <div style={{padding:'20px 24px', display:'flex', flexDirection:'column', gap:14}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Număr situație *</label>
              <input value={form.nr_situatie} onChange={e=>set('nr_situatie',e.target.value)} style={S.input} placeholder="SL1, SL2, NCS..." />
            </div>
            <div>
              <label style={S.label}>Tip</label>
              <select value={form.tip} onChange={e=>set('tip',e.target.value)} style={S.input}>
                {Object.entries(TIP_SL).map(([k,v])=>(
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Luna</label>
              <select value={form.luna} onChange={e=>set('luna',e.target.value)} style={S.input}>
                <option value="">—</option>
                {LUNI.map((l,i)=><option key={i} value={i+1}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Anul</label>
              <input type="number" value={form.an} onChange={e=>set('an',e.target.value)} style={S.input} min="2020" max="2030" />
            </div>
            <div>
              <label style={S.label}>Data depunere</label>
              <input type="date" value={form.data_depunere} onChange={e=>set('data_depunere',e.target.value)} style={S.input} />
            </div>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Valoare bază (RON)</label>
              <input type="number" value={form.valoare_baza_lei} onChange={e=>set('valoare_baza_lei',e.target.value)}
                style={S.input} placeholder="0.00" step="0.01" min="0" />
            </div>
            <div>
              <label style={S.label}>Coeficient ajustare</label>
              <input type="number" value={form.coeficient_ajustare} onChange={e=>set('coeficient_ajustare',e.target.value)}
                style={S.input} placeholder="1.000000" step="0.000001" />
            </div>
          </div>

          {valAjustata !== null && (
            <div style={{
              background:G.green+'11', border:`1px solid ${G.green}33`, borderRadius:8,
              padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center',
            }}>
              <span style={{fontSize:13, color:G.muted}}>Valoare ajustată calculată:</span>
              <span style={{fontSize:15, fontWeight:800, color:G.green}}>{fmtLei(valAjustata)}</span>
            </div>
          )}

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={S.label}>Status</label>
              <select value={form.status} onChange={e=>set('status',e.target.value)} style={S.input}>
                {Object.entries(STATUS_SL).map(([k,v])=>(
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={S.label}>Nr. factură</label>
              <input value={form.nr_factura} onChange={e=>set('nr_factura',e.target.value)} style={S.input} placeholder="ex: GAZ-288" />
            </div>
          </div>

          {(form.status === 'facturata' || form.status === 'incasata') && (
            <div>
              <label style={S.label}>Data factură</label>
              <input type="date" value={form.data_factura} onChange={e=>set('data_factura',e.target.value)} style={S.input} />
            </div>
          )}

          <div>
            <label style={S.label}>Observații</label>
            <textarea value={form.observatii} onChange={e=>set('observatii',e.target.value)}
              style={{...S.input, resize:'vertical', minHeight:60}}
              placeholder="Note, referințe, detalii..." />
          </div>
        </div>

        <div style={{
          padding:'14px 24px', borderTop:`1px solid ${G.border}`,
          display:'flex', gap:10, justifyContent:'flex-end', background:G.bg,
        }}>
          <button onClick={onClose} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer', fontSize:13}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding:'9px 18px', background:saving?G.muted:G.executie, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:13, cursor:saving?'not-allowed':'pointer', fontWeight:700,
          }}>{saving ? 'Se salvează...' : isNew ? '＋ Adaugă' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// proiectId: prop opțional — când vine din ProiectContextView, nu mai afișăm selector
// ══════════════════════════════════════════════════════════
export default function TabSituatiiPlata({ proiectId: proiectIdProp }) {
  const [proiecte, setProiecte]   = useState([])
  const [proiectId, setProiectId] = useState(proiectIdProp ? String(proiectIdProp) : '')
  const [lista, setLista]         = useState([])
  const [profile, setProfile]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [editItem, setEditItem]   = useState(null)
  const [deleteConf, setDeleteConf] = useState(null)
  const [aaModal, setAaModal]     = useState(null) // SL pentru care completam AA
  const { show: showToast, Toast } = useToast()

  useEffect(() => {
    const init = async () => {
      const { data:{user} } = await supabase.auth.getUser()
      if (user) {
        const { data:prof } = await supabase.from('profiles').select('id,is_owner,role,can_access_salarii').eq('id',user.id).single()
        setProfile(prof)
      }
      if (!proiectIdProp) {
        const { data } = await supabase.from('executie_proiecte').select('id,cod_intern,nume,valoare_lei,activ').eq('activ',true).order('cod_intern')
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

  const loadLista = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('executie_situatii_plata')
        .select('*')
        .eq('proiect_id', proiectId)
        .order('an').order('luna').order('nr_situatie')
      if (error) throw error
      setLista(data || [])
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadLista() }, [loadLista])

  const isOwner   = profile?.is_owner === true
  const canEdit   = isOwner || ['superadmin','manager_santier'].includes(profile?.role)
  // Valoarea totala e vizibila doar pentru cei cu acces salarii sau owner
  const showValori = isOwner || profile?.can_access_salarii

  const nav = useNavigate()
  // SL fără factură pentru proiectul curent
  const [slFaraFactura, setSlFaraFactura] = useState([])
  useEffect(() => {
    if (!proiectId) return
    supabase.from('v_sl_fara_factura').select('id,nr_situatie,luna,an').eq('proiect_id', proiectId)
      .then(({ data }) => setSlFaraFactura(data || []))
  }, [proiectId, lista]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const sitPlata  = lista.filter(s=>s.tip==='situatie_plata')
    const totalBaza = lista.reduce((a,s)=>a+(parseFloat(s.valoare_baza_lei)||0),0)
    const totalAj   = lista.reduce((a,s)=>a+(parseFloat(s.valoare_ajustata_lei)||0),0)
    const facturate = lista.filter(s=>['facturata','incasata'].includes(s.status)).reduce((a,s)=>a+(parseFloat(s.valoare_ajustata_lei)||0),0)
    const inPreg    = lista.filter(s=>s.status==='in_pregatire').length
    const aprobate  = lista.filter(s=>['aprobata','facturata','incasata'].includes(s.status)).length
    const alerteAA  = lista.filter(s=>parseFloat(s.valoare_ajustare_lei||0)>0 && !s.act_aditional_nr).length
    return { totalBaza, totalAj, facturate, inPreg, aprobate, nrSL: sitPlata.length, total: lista.length, alerteAA }
  }, [lista])

  const proiectCurent = proiecte.find(p=>String(p.id)===proiectId)

  const handleDelete = async (id) => {
    try {
      const { error } = await supabase.from('executie_situatii_plata').delete().eq('id', id)
      if (error) throw error
      showToast('Situație ștearsă', 'ok')
      loadLista()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setDeleteConf(null)
    }
  }

  return (
    <div style={{padding:'24px 28px', maxWidth:1400, margin:'0 auto'}}>
      <Toast />

      {/* ─── ALERTĂ SL fără factură ─── */}
      {slFaraFactura.length > 0 && (
        <div style={{
          background:G.orange+'0D', border:`1px solid ${G.orange}44`,
          borderRadius:8, padding:'10px 14px', marginBottom:16,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}>
            <span style={{color:G.orange}}>📄</span>
            <span style={{color:G.orange,fontWeight:700}}>
              {slFaraFactura.length === 1
                ? `${slFaraFactura[0].nr_situatie} (${LUNI[(slFaraFactura[0].luna||1)-1]} ${slFaraFactura[0].an}) nu are factură emisă`
                : `${slFaraFactura.length} situații fără factură: ${slFaraFactura.map(s=>s.nr_situatie).join(', ')}`}
            </span>
          </div>
          <button onClick={() => nav('/financiar')} style={{
            padding:'6px 14px', background:G.orange, border:'none',
            borderRadius:7, color:'#0D1117', fontSize:12, cursor:'pointer', fontWeight:700, flexShrink:0,
          }}>
            💰 Emite în Financiar →
          </button>
        </div>
      )}

      {/* ─── HEADER ─── */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16, flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800}}>💰 Situații de Plată</h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>SL1–SL6 · NCS · Acte adiționale · Tracking facturare</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
          {/* Selector proiect — ascuns când vine din ProiectContextView */}
          {!proiectIdProp && (
            <select value={proiectId} onChange={e=>setProiectId(e.target.value)} style={{...S.input, width:300, background:G.surface}}>
              {proiecte.map(p=>(
                <option key={p.id} value={p.id}>{p.cod_intern} — {p.nume.slice(0,50)}</option>
              ))}
            </select>
          )}
          {canEdit && (
            <button onClick={()=>setEditItem({})} style={{
              padding:'9px 16px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>＋ Situație</button>
          )}
        </div>
      </div>

      {/* ─── KPI ─── */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:12, marginBottom:24}}>
        {[
          {label:'Situații totale',    value:kpi.total,                   icon:'📋', color:G.executie},
          {label:'Situații plată',     value:kpi.nrSL,                    icon:'📊', color:G.blue},
          {label:'Aprobate/Facturate', value:kpi.aprobate,                icon:'✅', color:G.green},
          {label:'În pregătire',       value:kpi.inPreg,                  icon:'📝', color:kpi.inPreg>0?G.yellow:G.muted},
          ...(showValori ? [
            {label:'Total bază',       value:fmtLei(kpi.totalBaza),       icon:'💵', color:G.teal},
            {label:'Total ajustat',    value:fmtLei(kpi.totalAj),         icon:'💰', color:G.orange},
            {label:'Facturat/Încasat', value:fmtLei(kpi.facturate),       icon:'🧾', color:G.purple},
          ] : []),
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
              <div style={{fontSize:17, fontWeight:800, color:k.color, lineHeight:1}}>{k.value}</div>
              <div style={{fontSize:11, color:G.muted, marginTop:3}}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── BANNER ALERTE ACT ADIȚIONAL ─── */}
      {kpi.alerteAA > 0 && (
        <div style={{
          background:G.orange+'15', border:`1px solid ${G.orange}44`, borderRadius:10,
          padding:'12px 16px', marginBottom:20, display:'flex', alignItems:'center', gap:12,
        }}>
          <span style={{fontSize:20}}>⚠️</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700, fontSize:13, color:G.orange}}>
              {kpi.alerteAA} situație{kpi.alerteAA>1?'i':''} cu ajustare inflație fără Act Adițional semnat
            </div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Apasă ⚠️ pe fiecare SL pentru a completa numărul și data AA
            </div>
          </div>
        </div>
      )}

      {/* ─── TIMELINE ─── */}
      {lista.length > 0 && (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:12,
          padding:'16px 20px', marginBottom:20, overflowX:'auto',
        }}>
          <div style={{fontSize:12, color:G.muted, marginBottom:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px'}}>
            Timeline situații
          </div>
          <div style={{display:'flex', gap:8, minWidth:'max-content'}}>
            {lista.map(s => {
              const si = STATUS_SL[s.status] || STATUS_SL.in_pregatire
              const tip = TIP_SL[s.tip] || TIP_SL.situatie_plata
              return (
                <div key={s.id} style={{
                  background:si.bg, border:`1.5px solid ${si.color}44`,
                  borderRadius:10, padding:'10px 14px', minWidth:110,
                  cursor:'pointer', transition:'transform .1s',
                }} onClick={()=>canEdit && setEditItem(s)}
                  onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
                  onMouseLeave={e=>e.currentTarget.style.transform='none'}
                >
                  <div style={{fontSize:18, marginBottom:4}}>{si.icon}</div>
                  <div style={{fontWeight:800, fontSize:14, color:si.color}}>{s.nr_situatie}</div>
                  <div style={{fontSize:11, color:G.muted, marginTop:2}}>{tip.icon} {tip.label}</div>
                  {s.luna && <div style={{fontSize:11, color:G.dim, marginTop:2}}>{LUNI[s.luna-1]} {s.an}</div>}
                  {showValori && s.valoare_ajustata_lei && (
                    <div style={{fontSize:11, fontWeight:600, color:si.color, marginTop:4}}>
                      {fmtLei(s.valoare_ajustata_lei)}
                    </div>
                  )}
                  {s.nr_factura && (
                    <div style={{fontSize:10, color:G.dim, marginTop:2}}>🧾 {s.nr_factura}</div>
                  )}
                  {parseFloat(s.valoare_ajustare_lei||0)>0 && !s.act_aditional_nr && (
                    <div
                      onClick={e=>{e.stopPropagation(); setAaModal(s)}}
                      title="Ajustare fără Act Adițional — click pentru a completa"
                      style={{
                        marginTop:6, fontSize:10, fontWeight:700,
                        color:G.orange, cursor:'pointer',
                        background:G.orange+'22', borderRadius:4,
                        padding:'2px 6px', display:'inline-block',
                      }}
                    >⚠️ Lipsă AA</div>
                  )}
                  {s.act_aditional_nr && (
                    <div style={{fontSize:10, color:G.teal, marginTop:4}}>✅ {s.act_aditional_nr}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── TABEL ─── */}
      {loading ? (
        <div style={{textAlign:'center', padding:'60px 0', color:G.muted}}>⏳ Se încarcă...</div>
      ) : lista.length === 0 ? (
        <div style={{
          background:G.surface, border:`1px solid ${G.border}`, borderRadius:12,
          padding:'60px 40px', textAlign:'center',
        }}>
          <div style={{fontSize:48, marginBottom:12, opacity:.4}}>💰</div>
          <div style={{fontSize:16, fontWeight:600, marginBottom:8}}>Nicio situație de plată</div>
          {canEdit && (
            <button onClick={()=>setEditItem({})} style={{
              marginTop:16, padding:'10px 20px', background:G.executie, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>＋ Adaugă situație</button>
          )}
        </div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{background:G.surface, borderBottom:`1px solid ${G.border}`}}>
                {['Nr.','Tip','Luna/An','Data dep.', ...(showValori ? ['Valoare bază','Coef.','Valoare ajustată'] : []), 'Status','Factură','Data fact.',''].map((h,i)=>(
                  <th key={i} style={{
                    padding:'10px 12px', textAlign:'left', fontWeight:600,
                    color:G.muted, fontSize:11, textTransform:'uppercase', letterSpacing:'.3px', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((s,idx)=>{
                const si  = STATUS_SL[s.status] || STATUS_SL.in_pregatire
                const tip = TIP_SL[s.tip] || TIP_SL.situatie_plata
                return (
                  <tr key={s.id} style={{
                    borderBottom:`1px solid ${G.border2}`,
                    background:idx%2===0?'transparent':G.bg+'88',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=G.surface}
                    onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'transparent':G.bg+'88'}
                  >
                    <td style={{padding:'10px 12px', fontWeight:800, color:G.executie}}>{s.nr_situatie}</td>
                    <td style={{padding:'10px 12px', whiteSpace:'nowrap'}}>
                      <span style={{fontSize:12}}>{tip.icon} {tip.label}</span>
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, whiteSpace:'nowrap'}}>
                      {s.luna && s.an ? `${LUNI[s.luna-1]} ${s.an}` : '—'}
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, whiteSpace:'nowrap', fontSize:12}}>{fmtDate(s.data_depunere)}</td>
                    {showValori && <>
                      <td style={{padding:'10px 12px', textAlign:'right', whiteSpace:'nowrap', fontFamily:'monospace'}}>
                        {s.valoare_baza_lei ? fmtLei(s.valoare_baza_lei) : '—'}
                      </td>
                      <td style={{padding:'10px 12px', textAlign:'center', color:G.dim, fontSize:12}}>
                        {parseFloat(s.coeficient_ajustare)!==1 ? (
                          <span style={{color:G.yellow, fontWeight:600}}>×{parseFloat(s.coeficient_ajustare).toFixed(4)}</span>
                        ) : '×1'}
                      </td>
                      <td style={{padding:'10px 12px', textAlign:'right', fontWeight:700, whiteSpace:'nowrap', fontFamily:'monospace', color:G.green}}>
                        {s.valoare_ajustata_lei ? fmtLei(s.valoare_ajustata_lei) : '—'}
                      </td>
                    </>}
                    <td style={{padding:'10px 12px'}}>
                      <span style={{
                        padding:'3px 10px', borderRadius:12, fontSize:12, fontWeight:600,
                        background:si.bg, color:si.color, whiteSpace:'nowrap',
                      }}>{si.icon} {si.label}</span>
                    </td>
                    <td style={{padding:'10px 12px', color:s.nr_factura?G.text:G.dim, fontSize:12, whiteSpace:'nowrap'}}>
                      {s.nr_factura || (s.factura_cumulata ? <span style={{color:G.muted, fontSize:11}}>📎 {s.cumulata_cu_sl}</span> : '—')}
                    </td>
                    <td style={{padding:'10px 12px', color:G.muted, fontSize:12, whiteSpace:'nowrap'}}>{fmtDate(s.data_factura)}</td>
                    <td style={{padding:'10px 12px'}}>
                      <div style={{display:'flex', gap:6, alignItems:'center'}}>
                        {parseFloat(s.valoare_ajustare_lei||0)>0 && (
                          s.act_aditional_nr ? (
                            <span style={{fontSize:11, color:G.teal, fontWeight:600, whiteSpace:'nowrap'}}>✅ {s.act_aditional_nr}</span>
                          ) : (
                            <button onClick={()=>setAaModal(s)} title="Completează Act Adițional" style={{
                              padding:'4px 8px', background:G.orange+'22',
                              border:`1px solid ${G.orange}55`, borderRadius:6,
                              color:G.orange, cursor:'pointer', fontSize:11, fontWeight:700, whiteSpace:'nowrap',
                            }}>⚠️ AA lipsă</button>
                          )
                        )}
                        {canEdit && (
                          <button onClick={()=>setEditItem(s)} style={{
                            padding:'5px 10px', background:G.border2, border:'none',
                            borderRadius:6, color:G.muted, cursor:'pointer', fontSize:12,
                          }}>✏️</button>
                        )}
                        {isOwner && (
                          <button onClick={()=>setDeleteConf(s)} style={{
                            padding:'5px 10px', background:G.red+'22', border:'none',
                            borderRadius:6, color:G.red, cursor:'pointer', fontSize:12,
                          }}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {showValori && lista.length > 0 && (
              <tfoot>
                <tr style={{borderTop:`2px solid ${G.border}`, background:G.surface}}>
                  <td colSpan={4} style={{padding:'10px 12px', fontWeight:700, color:G.muted, fontSize:12}}>TOTAL</td>
                  <td style={{padding:'10px 12px', textAlign:'right', fontWeight:800, fontFamily:'monospace', color:G.teal}}>{fmtLei(kpi.totalBaza)}</td>
                  <td/>
                  <td style={{padding:'10px 12px', textAlign:'right', fontWeight:800, fontFamily:'monospace', color:G.orange}}>{fmtLei(kpi.totalAj)}</td>
                  <td colSpan={4}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {editItem !== null && (
        <SLModal
          item={editItem?.id ? editItem : null}
          proiectId={parseInt(proiectId)}
          onClose={()=>setEditItem(null)}
          onSaved={()=>{ setEditItem(null); loadLista() }}
          showToast={showToast}
        />
      )}

      {aaModal && (
        <AAModal
          sl={aaModal}
          onClose={()=>setAaModal(null)}
          onSaved={()=>{ setAaModal(null); loadLista() }}
          showToast={showToast}
        />
      )}

      {deleteConf && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.8)', zIndex:1020, display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{background:G.surface, border:`1px solid ${G.red}`, borderRadius:12, padding:28, maxWidth:380, width:'90%', textAlign:'center'}}>
            <div style={{fontSize:32, marginBottom:12}}>🗑</div>
            <div style={{fontSize:15, fontWeight:700, marginBottom:8}}>Ștergi <span style={{color:G.red}}>{deleteConf.nr_situatie}</span>?</div>
            <div style={{color:G.muted, fontSize:13, marginBottom:20}}>Ireversibil.</div>
            <div style={{display:'flex', gap:10, justifyContent:'center'}}>
              <button onClick={()=>setDeleteConf(null)} style={{padding:'9px 18px', background:G.border, border:'none', borderRadius:7, color:G.text, cursor:'pointer'}}>Anulează</button>
              <button onClick={()=>handleDelete(deleteConf.id)} style={{padding:'9px 18px', background:G.red, border:'none', borderRadius:7, color:'#fff', fontWeight:700, cursor:'pointer'}}>Șterge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
