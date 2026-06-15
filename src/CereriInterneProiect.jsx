// ════════════════════════════════════════════════════════════════════════════
// CERERE INTERNĂ DE ACHIZIȚII — componentă reutilizabilă (v1.0 · 15.06.2026)
// Montată ÎN OGLINDĂ în 2 locuri (aceleași date, același ecran):
//   • Execuție → Proiect → tab „Cereri interne"  (MP creează cererea)
//   • Comercial/Achiziții → Proiect → tab „Cereri interne"  (Kostas o procesează)
// Single source of truth: tabelele `comenzi` (tip='executie') + `comanda_linii`,
// legate de proiect prin `comenzi.proiect_id` → executie_proiecte.id.
// Flux SIMPLU (decizie Razvan 15.06): MP → direct la Achiziții (fără șef).
//   deschis → in_lucru → comandata → in_tranzit → ajunsa → finalizata
//   (+ anulata / respinsa)
// PDF identic cu Excel-ul (3 secțiuni + semnături auto din HR), pattern ordin.
// Props: { proiectId }  — își ia singură profilul + datele + toast.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'

// ─── Theme (convenția repo) ──────────────────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9',
}
const S = {
  card:  { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%', boxSizing:'border-box' },
  btnP:  { background:'#1F6FEB', color:'#fff', border:'none', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS:  { background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnIcon:{ background:'transparent', border:`1px solid ${G.border2}`, borderRadius:8, padding:'7px 12px', fontSize:15, cursor:'pointer', color:G.text },
  overlay:{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', zIndex:9000, overflowY:'auto' },
}

const BUCKET_SEMN = 'hr-semnaturi'

// Responsabili PE ROL pentru cererea internă (decizie Razvan: pe document apar
// responsabilii reali, nu cine a apăsat click). Semnătura se caută AUTOMAT în HR
// după nume (fuzzy); dacă lipsește → linie pentru semnătură olografă.
const RESPONSABIL_ACHIZITII = 'TSIATSIOS KONSTANTINOS' // Kostas — Dep. Achiziții
// Șef Departament per departament (default Execuție = Pantea, din comenzi_aprobatori)
const SEFI_DEPARTAMENT = {
  'Executie': 'PANTEA CONSTANTIN',
  'Execuție': 'PANTEA CONSTANTIN',
}

const STATUS_INFO = {
  deschis:    { label:'Deschisă',     emoji:'📨', color:G.blue   },
  in_lucru:   { label:'În lucru',     emoji:'🔧', color:G.yellow },
  comandata:  { label:'Comandată',    emoji:'🛒', color:G.purple },
  in_tranzit: { label:'În tranzit',   emoji:'🚚', color:G.orange },
  ajunsa:     { label:'Ajunsă',       emoji:'📦', color:G.orange },
  finalizata: { label:'Finalizată',   emoji:'✅', color:G.green  },
  anulata:    { label:'Anulată',      emoji:'⛔', color:G.dim    },
  respinsa:   { label:'Respinsă',     emoji:'❌', color:G.red    },
}
const FLOW_STEPS = ['deschis','in_lucru','comandata','in_tranzit','ajunsa','finalizata']
const PRIO_INFO = {
  urgenta: { label:'Urgentă', color:G.red },
  normala: { label:'Normală', color:G.muted },
  scazuta: { label:'Scăzută', color:G.dim },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtData = (d) => { if(!d) return '—'; const x=new Date(d); return isNaN(x)?'—':x.toLocaleDateString('ro-RO') }
const fmtDataOra = (d) => { if(!d) return '—'; const x=new Date(d); return isNaN(x)?'—':x.toLocaleDateString('ro-RO')+' '+x.toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'}) }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]))
const normalize = (s) => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()
function findEmployeeByName(name, employees) {
  const toks = normalize(name).split(' ').filter(t => t.length >= 2)
  if (!toks.length) return null
  let best=null, bestScore=0
  for (const e of employees || []) {
    const target = ' ' + normalize(e.name) + ' '
    const score = toks.filter(t => target.includes(' '+t)).length
    if (score >= 2 && score > bestScore) { best=e; bestScore=score }
  }
  return best
}
// CORS fix html2canvas: signed URL → dataURL base64
async function fetchAsDataURL(url) {
  try {
    const resp = await fetch(url); const blob = await resp.blob()
    return await new Promise((res,rej) => { const r=new FileReader(); r.onloadend=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob) })
  } catch { return null }
}

// ─── Toast minimal (self-contained) ──────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState(null)
  const showToast = useCallback((msg, type='success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3200)
  }, [])
  const ToastEl = toast ? (
    <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:9999,
      background: toast.type==='error'?G.red:toast.type==='info'?G.blue:G.green, color:'#fff',
      padding:'11px 20px', borderRadius:10, fontSize:14, fontWeight:600, boxShadow:'0 8px 30px rgba(0,0,0,.45)', maxWidth:'90vw' }}>
      {toast.msg}
    </div>
  ) : null
  return { showToast, ToastEl }
}

// ─── Badge status ────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const si = STATUS_INFO[status] || { label:status, emoji:'•', color:G.muted }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700,
      padding:'3px 10px', borderRadius:20, background:si.color+'22', color:si.color }}>
      {si.emoji} {si.label}
    </span>
  )
}
function FluxTimeline({ status }) {
  if (status==='anulata' || status==='respinsa') return null
  const idx = FLOW_STEPS.indexOf(status)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap', margin:'6px 0' }}>
      {FLOW_STEPS.map((st,i) => {
        const done = i <= idx
        const si = STATUS_INFO[st]
        return (
          <div key={st} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:11, fontWeight:done?700:500, padding:'2px 8px', borderRadius:14,
              background: done ? si.color+'22' : 'transparent', color: done ? si.color : G.dim,
              border:`1px solid ${done?si.color+'55':G.border}` }}>{si.emoji} {si.label}</span>
            {i < FLOW_STEPS.length-1 && <span style={{ color: i<idx?si.color:G.border, fontSize:11 }}>→</span>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Editor linii (în formular) ──────────────────────────────────────────────
const UM_OPTIUNI = ['buc','set','cutii','kg','m','ml','l','rola','pereche','colac','to','altă']
function LiniiEditor({ linii, setLinii }) {
  const upd = (i, k, v) => setLinii(linii.map((l,idx) => idx===i ? { ...l, [k]:v } : l))
  const add = () => setLinii([...linii, { denumire:'', cantitate:'', um:'buc', observatii:'' }])
  const del = (i) => setLinii(linii.filter((_,idx) => idx!==i))
  return (
    <div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {linii.map((l,i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'28px 1fr 90px 110px 1fr 34px', gap:8, alignItems:'center' }}>
            <span style={{ color:G.dim, fontSize:13, textAlign:'center' }}>{i+1}</span>
            <input style={S.input} placeholder="Denumire material / serviciu" value={l.denumire} onChange={e=>upd(i,'denumire',e.target.value)} />
            <input style={S.input} type="number" min="0" step="any" placeholder="Cant." value={l.cantitate} onChange={e=>upd(i,'cantitate',e.target.value)} />
            <select style={S.input} value={l.um} onChange={e=>upd(i,'um',e.target.value)}>
              {UM_OPTIUNI.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input style={S.input} placeholder="Specificații / Observații" value={l.observatii} onChange={e=>upd(i,'observatii',e.target.value)} />
            <button type="button" onClick={()=>del(i)} title="Șterge rândul"
              style={{ ...S.btnIcon, padding:'7px 9px', borderColor:G.red+'55', color:G.red }}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} style={{ ...S.btnS, marginTop:10, borderStyle:'dashed', borderColor:G.green+'66', color:G.green }}>
        ＋ Adaugă rând
      </button>
    </div>
  )
}

// ─── Modal formular cerere (creare / editare draft) ──────────────────────────
function CerereFormModal({ initial, proiect, defaultDepart, onClose, onSaved, showToast }) {
  const editing = !!initial
  const [departament, setDepartament] = useState(initial?.departament || defaultDepart || '')
  const [termen, setTermen] = useState(initial?.data_termen_estimat || '')
  const [prioritate, setPrioritate] = useState(initial?.prioritate || 'normala')
  const [observatii, setObservatii] = useState(initial?.observatii || '')
  const [linii, setLinii] = useState(
    initial?.linii?.length
      ? initial.linii.map(l => ({ denumire:l.denumire||'', cantitate:l.cantitate??'', um:l.um||'buc', observatii:l.observatii||'' }))
      : [{ denumire:'', cantitate:'', um:'buc', observatii:'' }]
  )
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const liniiValide = linii.filter(l => (l.denumire||'').trim() && Number(l.cantitate) > 0)
    if (!liniiValide.length) { showToast('Adaugă cel puțin un material cu cantitate > 0', 'error'); return }
    setBusy(true)
    try {
      const { data:{ user } } = await supabase.auth.getUser()
      const header = {
        proiect_id: proiect.id,
        site_id: proiect.site_id || null,
        tip: 'executie',
        prioritate,
        departament: (departament||'').trim() || null,
        data_termen_estimat: termen || null,
        observatii: (observatii||'').trim() || null,
        super_user_required: false,
      }
      let comandaId = initial?.id
      if (editing) {
        const { error } = await supabase.from('comenzi').update(header).eq('id', comandaId)
        if (error) throw error
        // rescriem liniile (simplu + robust pentru draft)
        await supabase.from('comanda_linii').delete().eq('comanda_id', comandaId)
      } else {
        const { data:ins, error } = await supabase.from('comenzi')
          .insert({ ...header, status:'deschis', deschis_de: user?.id || null })
          .select('id').single()
        if (error) throw error
        comandaId = ins.id
      }
      const rows = liniiValide.map((l, i) => ({
        comanda_id: comandaId,
        denumire: l.denumire.trim(),
        cantitate: Number(l.cantitate),
        um: l.um || null,
        observatii: (l.observatii||'').trim() || null,
        display_order: i,
      }))
      const { error: eL } = await supabase.from('comanda_linii').insert(rows)
      if (eL) throw eL
      showToast(editing ? 'Cerere actualizată' : 'Cerere trimisă către Achiziții ✅')
      onSaved()
    } catch (e) {
      console.error(e); showToast('Eroare la salvare: ' + (e.message || e), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.card, width:'min(840px,100%)', padding:0 }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'16px 22px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:17, fontWeight:800 }}>📋 {editing ? 'Editează cererea' : 'Cerere internă de achiziții'}</div>
          <button onClick={onClose} style={S.btnIcon}>✕</button>
        </div>

        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:16 }}>
          {/* Secțiunea 1 */}
          <div style={{ fontSize:12, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px' }}>Secțiunea 1 — Detalii cerere</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:12, color:G.muted }}>Proiect / Lucrare</label>
              <input style={{ ...S.input, opacity:.75 }} value={`${proiect.cod_intern?`[${proiect.cod_intern}] `:''}${proiect.nume||''}`} disabled />
            </div>
            <div>
              <label style={{ fontSize:12, color:G.muted }}>Departament solicitant</label>
              <input style={S.input} value={departament} onChange={e=>setDepartament(e.target.value)} placeholder="ex: Execuție" />
            </div>
            <div>
              <label style={{ fontSize:12, color:G.muted }}>Termen dorit de livrare</label>
              <input style={S.input} type="date" value={termen||''} onChange={e=>setTermen(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize:12, color:G.muted }}>Prioritate</label>
              <select style={S.input} value={prioritate} onChange={e=>setPrioritate(e.target.value)}>
                <option value="normala">Normală</option>
                <option value="urgenta">Urgentă</option>
                <option value="scazuta">Scăzută</option>
              </select>
            </div>
          </div>

          {/* Secțiunea 2 */}
          <div style={{ fontSize:12, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginTop:4 }}>Secțiunea 2 — Materiale / servicii</div>
          <LiniiEditor linii={linii} setLinii={setLinii} />

          <div>
            <label style={{ fontSize:12, color:G.muted }}>Observații generale (opțional)</label>
            <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={observatii} onChange={e=>setObservatii(e.target.value)} />
          </div>
        </div>

        <div style={{ padding:'14px 22px', borderTop:`1px solid ${G.border}`, display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose} style={S.btnS} disabled={busy}>Anulează</button>
          <button onClick={save} style={S.btnP} disabled={busy}>{busy ? 'Se salvează…' : (editing ? 'Salvează' : '📨 Trimite cererea')}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal detaliu + acțiuni ─────────────────────────────────────────────────
function CerereDetailModal({ cerere, proiect, profilesMap, canProcess, isOwner, onClose, onAction, onEdit, onPdf, busy }) {
  const [livrare, setLivrare] = useState(cerere.data_livrare_estimata || '')
  const si = STATUS_INFO[cerere.status] || {}
  const solicitant = profilesMap[cerere.deschis_de] || '—'
  const linii = (cerere.linii || []).slice().sort((a,b)=>(a.display_order||0)-(b.display_order||0))

  const Btn = ({ children, color=G.blue, onClick }) => (
    <button onClick={onClick} disabled={busy} style={{ ...S.btnS, borderColor:color+'66', color }}>{children}</button>
  )

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.card, width:'min(820px,100%)', padding:0 }} onClick={e=>e.stopPropagation()}>
        <div style={{ padding:'16px 22px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800 }}>{cerere.numar_comanda || 'Cerere'}</div>
            <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>Solicitant: {solicitant} · {fmtDataOra(cerere.created_at)}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <StatusBadge status={cerere.status} />
            <button onClick={onClose} style={S.btnIcon}>✕</button>
          </div>
        </div>

        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>
          <FluxTimeline status={cerere.status} />

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, fontSize:13 }}>
            <div><span style={{ color:G.muted }}>Departament:</span> {cerere.departament || '—'}</div>
            <div><span style={{ color:G.muted }}>Prioritate:</span> <span style={{ color:(PRIO_INFO[cerere.prioritate]||{}).color }}>{(PRIO_INFO[cerere.prioritate]||{}).label || cerere.prioritate}</span></div>
            <div><span style={{ color:G.muted }}>Termen dorit:</span> {fmtData(cerere.data_termen_estimat)}</div>
          </div>

          {/* Tabel linii */}
          <div style={{ ...S.card, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead><tr style={{ background:G.bg }}>
                <th style={{ padding:'8px 10px', textAlign:'left', color:G.muted, width:34 }}>#</th>
                <th style={{ padding:'8px 10px', textAlign:'left', color:G.muted }}>Denumire</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:G.muted, width:80 }}>Cant.</th>
                <th style={{ padding:'8px 10px', textAlign:'left', color:G.muted, width:70 }}>UM</th>
                <th style={{ padding:'8px 10px', textAlign:'left', color:G.muted }}>Specificații</th>
              </tr></thead>
              <tbody>
                {linii.map((l,i) => (
                  <tr key={l.id||i} style={{ borderTop:`1px solid ${G.border}` }}>
                    <td style={{ padding:'8px 10px', color:G.dim }}>{i+1}</td>
                    <td style={{ padding:'8px 10px' }}>{l.denumire}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right' }}>{l.cantitate}</td>
                    <td style={{ padding:'8px 10px' }}>{l.um || '—'}</td>
                    <td style={{ padding:'8px 10px', color:G.muted }}>{l.observatii || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cerere.observatii && <div style={{ fontSize:13 }}><span style={{ color:G.muted }}>Observații:</span> {cerere.observatii}</div>}

          {/* Câmp termen livrare estimat — editabil de Achiziții pe stările în lucru+ */}
          {canProcess && ['in_lucru','comandata','in_tranzit','ajunsa'].includes(cerere.status) && (
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label style={{ fontSize:12, color:G.muted }}>Termen livrare estimat (Achiziții):</label>
              <input style={{ ...S.input, width:170 }} type="date" value={livrare||''} onChange={e=>setLivrare(e.target.value)} />
              <button style={S.btnS} disabled={busy} onClick={()=>onAction('set_livrare', { data_livrare_estimata: livrare || null })}>Salvează termen</button>
            </div>
          )}
        </div>

        {/* Acțiuni */}
        <div style={{ padding:'14px 22px', borderTop:`1px solid ${G.border}`, display:'flex', flexWrap:'wrap', gap:10, justifyContent:'space-between' }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button onClick={()=>onPdf(cerere)} style={{ ...S.btnS, borderColor:G.purple+'66', color:G.purple }} disabled={busy}>📄 PDF cu semnături</button>
            {cerere.status==='deschis' && <Btn color={G.yellow} onClick={()=>onEdit(cerere)}>✏️ Editează</Btn>}
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {/* Acțiuni Achiziții (flux) */}
            {canProcess && cerere.status==='deschis' && <>
              <Btn color={G.yellow} onClick={()=>onAction('preia')}>🔧 Preia (în lucru)</Btn>
              <Btn color={G.red} onClick={()=>onAction('status', { status:'respinsa' })}>❌ Respinge</Btn>
            </>}
            {canProcess && cerere.status==='in_lucru' && <Btn color={G.purple} onClick={()=>onAction('status', { status:'comandata' })}>🛒 Marchează comandată</Btn>}
            {canProcess && cerere.status==='comandata' && <Btn color={G.orange} onClick={()=>onAction('status', { status:'in_tranzit' })}>🚚 În tranzit</Btn>}
            {canProcess && cerere.status==='in_tranzit' && <Btn color={G.orange} onClick={()=>onAction('status', { status:'ajunsa' })}>📦 Ajunsă</Btn>}
            {canProcess && cerere.status==='ajunsa' && <Btn color={G.green} onClick={()=>onAction('status', { status:'finalizata' })}>✅ Finalizează</Btn>}
            {/* Anulare: creator pe deschis, sau owner oricând (non-final) */}
            {(isOwner || cerere.status==='deschis') && !['finalizata','anulata','respinsa'].includes(cerere.status) &&
              <Btn color={G.dim} onClick={()=>onAction('status', { status:'anulata' })}>⛔ Anulează</Btn>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTA PRINCIPALĂ
// ════════════════════════════════════════════════════════════════════════════
export default function CereriInterneProiect({ proiectId }) {
  const { showToast, ToastEl } = useToast()
  const [profile, setProfile] = useState(null)
  const [proiect, setProiect] = useState(null)
  const [cereri, setCereri] = useState([])
  const [employees, setEmployees] = useState([])
  const [profilesList, setProfilesList] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editCerere, setEditCerere] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [fStatus, setFStatus] = useState('active') // active | toate | <status>

  const pdfHostRef = useRef(null)

  // Profil
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data:{ user } } = await supabase.auth.getUser()
      if (cancelled || !user) return
      const { data } = await supabase.from('profiles')
        .select('id, name, is_owner, can_create_comenzi, can_process_achizitii')
        .eq('id', user.id).single()
      if (!cancelled) setProfile(data)
    })()
    return () => { cancelled = true }
  }, [])

  const isOwner = profile?.is_owner === true
  const canCreate = isOwner || profile?.can_create_comenzi === true || profile?.can_process_achizitii === true
  const canProcess = isOwner || profile?.can_process_achizitii === true

  const loadAll = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      const [rProi, rCer, rEmp, rProf] = await Promise.all([
        supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id, mp_employee_id').eq('id', proiectId).single(),
        supabase.from('comenzi').select('*, linii:comanda_linii(*)').eq('proiect_id', proiectId).eq('tip','executie').order('created_at', { ascending:false }),
        supabase.from('employees').select('id, name, department, departament_hr'),
        supabase.from('profiles').select('id, name'),
      ])
      setProiect(rProi.data || null)
      setCereri(rCer.data || [])
      setEmployees(rEmp.data || [])
      setProfilesList(rProf.data || [])
    } catch (e) {
      console.error(e); showToast('Eroare la încărcare: ' + (e.message || e), 'error')
    } finally { setLoading(false) }
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  const profilesMap = useMemo(() => Object.fromEntries(profilesList.map(p => [p.id, p.name])), [profilesList])
  const defaultDepart = useMemo(() => {
    if (!proiect?.mp_employee_id) return 'Execuție'
    const e = employees.find(x => x.id === proiect.mp_employee_id)
    return e?.department || e?.departament_hr || 'Execuție'
  }, [proiect, employees])

  const cereriFiltrate = useMemo(() => {
    if (fStatus === 'toate') return cereri
    if (fStatus === 'active') return cereri.filter(c => !['finalizata','anulata','respinsa'].includes(c.status))
    return cereri.filter(c => c.status === fStatus)
  }, [cereri, fStatus])

  const detailCerere = useMemo(() => cereri.find(c => c.id === detailId) || null, [cereri, detailId])

  // ── Acțiuni status ──────────────────────────────────────────────────────
  const doAction = useCallback(async (action, payload={}) => {
    const c = cereri.find(x => x.id === detailId)
    if (!c) return
    setBusy(true)
    try {
      const { data:{ user } } = await supabase.auth.getUser()
      let upd = {}
      if (action === 'preia') upd = { status:'in_lucru', preluat_de:user?.id||null, preluat_la:new Date().toISOString() }
      else if (action === 'status') {
        upd = { status: payload.status }
        if (payload.status === 'finalizata') upd.finalizata_la = new Date().toISOString()
      }
      else if (action === 'set_livrare') upd = { data_livrare_estimata: payload.data_livrare_estimata }
      const { error } = await supabase.from('comenzi').update(upd).eq('id', c.id)
      if (error) throw error
      showToast('Actualizat ✅')
      await loadAll()
    } catch (e) {
      console.error(e); showToast('Eroare: ' + (e.message || e), 'error')
    } finally { setBusy(false) }
  }, [cereri, detailId, loadAll, showToast])

  // ── PDF cerere (identic Excel + semnături auto) ──────────────────────────
  const getSemnaturaDataURL = useCallback(async (name) => {
    const emp = findEmployeeByName(name, employees)
    if (!emp) return null
    const { data } = await supabase.from('hr_semnaturi_electronice')
      .select('fisier_path').eq('employee_id', emp.id).eq('activ', true).maybeSingle()
    if (!data?.fisier_path) return null
    const { data: signed } = await supabase.storage.from(BUCKET_SEMN).createSignedUrl(data.fisier_path, 120)
    if (!signed?.signedUrl) return null
    return await fetchAsDataURL(signed.signedUrl)
  }, [employees])

  const generatePdf = useCallback(async (cerere) => {
    setBusy(true)
    try {
      const linii = (cerere.linii || []).slice().sort((a,b)=>(a.display_order||0)-(b.display_order||0))
      const solicitantNume = profilesMap[cerere.deschis_de] || ''
      const sefNume = SEFI_DEPARTAMENT[cerere.departament] || ''
      // semnături (fuzzy după nume)
      const [semnSolic, semnSef, semnAchiz] = await Promise.all([
        getSemnaturaDataURL(solicitantNume),
        sefNume ? getSemnaturaDataURL(sefNume) : Promise.resolve(null),
        getSemnaturaDataURL(RESPONSABIL_ACHIZITII),
      ])
      const azi = new Date().toLocaleDateString('ro-RO')

      const semnBloc = (rol, nume, img) => `
        <tr>
          <td style="border:1px solid #999;padding:7px 9px;font-size:11px;">${esc(rol)}</td>
          <td style="border:1px solid #999;padding:7px 9px;font-size:11px;">${esc(nume||'—')}</td>
          <td style="border:1px solid #999;padding:4px;height:46px;text-align:center;vertical-align:middle;">
            ${img ? `<img src="${img}" style="max-height:40px;max-width:150px;" />` : ''}
          </td>
          <td style="border:1px solid #999;padding:7px 9px;font-size:11px;text-align:center;">${esc(azi)}</td>
        </tr>`

      const html = `
        <div style="width:738px;padding:0 4px;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;">
          <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #1F6FEB;padding-bottom:10px;margin-bottom:14px;">
            <img src="${LOGO_B64}" style="height:58px;width:auto;object-fit:contain;" />
            <div>
              <div style="font-size:18px;font-weight:800;letter-spacing:.5px;">CERERE INTERNĂ DE ACHIZIȚII</div>
              <div style="font-size:12px;color:#555;">Gazpet Instal SRL · ${esc(cerere.numar_comanda||'')}</div>
            </div>
          </div>

          <div style="font-size:12px;font-weight:700;color:#1F6FEB;margin:6px 0;">Secțiunea 1 — Detalii cerere</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
            <tr><td style="border:1px solid #ccc;padding:6px 9px;width:35%;background:#f4f6fa;font-weight:600;">Nr. cerere</td><td style="border:1px solid #ccc;padding:6px 9px;">${esc(cerere.numar_comanda||'—')}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 9px;background:#f4f6fa;font-weight:600;">Solicitant</td><td style="border:1px solid #ccc;padding:6px 9px;">${esc(solicitantNume||'—')}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 9px;background:#f4f6fa;font-weight:600;">Departament</td><td style="border:1px solid #ccc;padding:6px 9px;">${esc(cerere.departament||'—')}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 9px;background:#f4f6fa;font-weight:600;">Proiect / Lucrare</td><td style="border:1px solid #ccc;padding:6px 9px;">${esc((proiect?.cod_intern?`[${proiect.cod_intern}] `:'')+(proiect?.nume||''))}</td></tr>
            <tr><td style="border:1px solid #ccc;padding:6px 9px;background:#f4f6fa;font-weight:600;">Termen dorit de livrare</td><td style="border:1px solid #ccc;padding:6px 9px;">${esc(fmtData(cerere.data_termen_estimat))}</td></tr>
          </table>

          <div style="font-size:12px;font-weight:700;color:#1F6FEB;margin:6px 0;">Secțiunea 2 — Detalii achiziție</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
            <thead><tr style="background:#1F6FEB;color:#fff;">
              <th style="border:1px solid #1F6FEB;padding:6px;width:40px;">Nr.</th>
              <th style="border:1px solid #1F6FEB;padding:6px;text-align:left;">Denumire material / serviciu</th>
              <th style="border:1px solid #1F6FEB;padding:6px;width:70px;">Cant.</th>
              <th style="border:1px solid #1F6FEB;padding:6px;width:60px;">UM</th>
              <th style="border:1px solid #1F6FEB;padding:6px;text-align:left;">Specificații / Observații</th>
            </tr></thead>
            <tbody>
              ${linii.map((l,i)=>`<tr>
                <td style="border:1px solid #ccc;padding:6px;text-align:center;">${i+1}</td>
                <td style="border:1px solid #ccc;padding:6px;">${esc(l.denumire)}</td>
                <td style="border:1px solid #ccc;padding:6px;text-align:center;">${esc(l.cantitate)}</td>
                <td style="border:1px solid #ccc;padding:6px;text-align:center;">${esc(l.um||'')}</td>
                <td style="border:1px solid #ccc;padding:6px;">${esc(l.observatii||'')}</td>
              </tr>`).join('')}
            </tbody>
          </table>

          <div style="font-size:12px;font-weight:700;color:#1F6FEB;margin:6px 0;">Secțiunea 3 — Aprobare</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f4f6fa;">
              <th style="border:1px solid #999;padding:6px;text-align:left;">Funcție</th>
              <th style="border:1px solid #999;padding:6px;text-align:left;">Nume</th>
              <th style="border:1px solid #999;padding:6px;">Semnătură</th>
              <th style="border:1px solid #999;padding:6px;width:90px;">Data</th>
            </tr></thead>
            <tbody>
              ${semnBloc('Solicitant', solicitantNume, semnSolic)}
              ${semnBloc('Șef Departament', sefNume, semnSef)}
              ${semnBloc('Responsabil Achiziții', RESPONSABIL_ACHIZITII, semnAchiz)}
            </tbody>
          </table>

          <div style="margin-top:16px;font-size:9px;color:#999;text-align:right;">Generat din Gazpet ERP · ${esc(new Date().toLocaleString('ro-RO'))}</div>
        </div>`

      const host = pdfHostRef.current
      host.innerHTML = html
      host.style.position = 'fixed'; host.style.left = '-10000px'; host.style.top = '0'
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(host.firstElementChild, { scale:2, backgroundColor:'#ffffff', useCORS:true })
      host.innerHTML = ''
      const pdf = new jsPDF('p','mm','a4')
      const pw = 210, ph = 297, margin = 8
      const imgW = pw - margin*2
      const imgH = canvas.height * imgW / canvas.width
      const dataURL = canvas.toDataURL('image/png')
      if (imgH <= ph - margin*2) {
        pdf.addImage(dataURL, 'PNG', margin, margin, imgW, imgH, undefined, 'FAST')
      } else {
        // paginare simplă dacă depășește o pagină
        let y = 0
        const pageImgH = (ph - margin*2)
        while (y < imgH) {
          pdf.addImage(dataURL, 'PNG', margin, margin - y, imgW, imgH, undefined, 'FAST')
          y += pageImgH
          if (y < imgH) pdf.addPage()
        }
      }
      pdf.save(`CerereInterna_${(cerere.numar_comanda||'cerere').replace(/[^\w-]/g,'_')}.pdf`)
      showToast('PDF generat ✅')
    } catch (e) {
      console.error(e); showToast('Eroare la PDF: ' + (e.message || e), 'error')
    } finally { setBusy(false) }
  }, [employees, profilesMap, proiect, getSemnaturaDataURL, showToast])

  // ── Render ────────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    active: cereri.filter(c => !['finalizata','anulata','respinsa'].includes(c.status)).length,
    toate: cereri.length,
  }), [cereri])

  return (
    <div style={{ padding:'18px 28px', color:G.text, fontFamily:"'Syne','Barlow',sans-serif" }}>
      {ToastEl}
      <div ref={pdfHostRef} aria-hidden="true" />

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800 }}>📋 Cereri interne de achiziții</div>
          <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>
            {proiect ? `${proiect.cod_intern?`[${proiect.cod_intern}] `:''}${proiect.nume||''}` : 'Se încarcă…'}
          </div>
        </div>
        {canCreate && (
          <button onClick={()=>{ setEditCerere(null); setShowForm(true) }} style={S.btnP}>＋ Cerere nouă</button>
        )}
      </div>

      {/* Filtre */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        {[
          { k:'active', label:`Active (${counts.active})` },
          { k:'toate', label:`Toate (${counts.toate})` },
          ...Object.keys(STATUS_INFO).map(s => ({ k:s, label:`${STATUS_INFO[s].emoji} ${STATUS_INFO[s].label}` })),
        ].map(f => {
          const active = fStatus === f.k
          return (
            <button key={f.k} onClick={()=>setFStatus(f.k)} style={{
              ...S.btnS, padding:'6px 14px', fontSize:13,
              background: active ? G.blue+'22' : G.surface,
              borderColor: active ? G.blue : G.border2,
              color: active ? G.blue : G.muted, fontWeight: active ? 700 : 500,
            }}>{f.label}</button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ color:G.muted, padding:40, textAlign:'center' }}>Se încarcă…</div>
      ) : cereriFiltrate.length === 0 ? (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.muted }}>
          {cereri.length === 0 ? 'Nicio cerere internă pe acest proiect încă.' : 'Nicio cerere pe filtrul selectat.'}
          {canCreate && cereri.length === 0 && (
            <div style={{ marginTop:14 }}>
              <button onClick={()=>{ setEditCerere(null); setShowForm(true) }} style={S.btnP}>＋ Creează prima cerere</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {cereriFiltrate.map(c => {
            const nrLinii = (c.linii || []).length
            const prio = PRIO_INFO[c.prioritate] || {}
            return (
              <div key={c.id} onClick={()=>setDetailId(c.id)} style={{
                ...S.card, padding:'14px 18px', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
                transition:'border-color .15s',
              }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=G.blue+'66'}
                onMouseLeave={e=>e.currentTarget.style.borderColor=G.border}>
                <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:200, flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <span style={{ fontWeight:700, fontSize:14 }}>{c.numar_comanda || 'Cerere'}</span>
                    {c.prioritate === 'urgenta' && <span style={{ fontSize:11, color:prio.color, fontWeight:700 }}>● {prio.label}</span>}
                  </div>
                  <div style={{ fontSize:12, color:G.muted }}>
                    {nrLinii} {nrLinii===1?'articol':'articole'} · {profilesMap[c.deschis_de] || '—'} · {fmtData(c.created_at)}
                    {c.data_termen_estimat && <> · 🎯 {fmtData(c.data_termen_estimat)}</>}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </div>
            )
          })}
        </div>
      )}

      {/* Modale */}
      {showForm && proiect && (
        <CerereFormModal
          initial={editCerere}
          proiect={proiect}
          defaultDepart={defaultDepart}
          onClose={()=>{ setShowForm(false); setEditCerere(null) }}
          onSaved={()=>{ setShowForm(false); setEditCerere(null); loadAll() }}
          showToast={showToast}
        />
      )}

      {detailCerere && (
        <CerereDetailModal
          cerere={detailCerere}
          proiect={proiect}
          profilesMap={profilesMap}
          canProcess={canProcess}
          isOwner={isOwner}
          busy={busy}
          onClose={()=>setDetailId(null)}
          onAction={doAction}
          onEdit={(c)=>{ setDetailId(null); setEditCerere(c); setShowForm(true) }}
          onPdf={generatePdf}
        />
      )}
    </div>
  )
}
