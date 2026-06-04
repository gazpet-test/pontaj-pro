// ════════════════════════════════════════════════════════════════
// ContracteTertiTab.jsx — Sub-tab Administrativ „Contracte cu terți"
// v3 LIVE 02.06.2026 — Extensie: categorii + sens + partener liber
//                       + acte adiționale + acces can_manage_contracts
// v4 03.06.2026 — Drag & drop PDF + link la Proiect Execuție
//   • Zona PDF: drag & drop + highlight vizual
//   • Câmp „Proiect Execuție asociat" (vizibil când categorie=executie)
//   • La salvare: UPDATE executie_proiecte.contract_id + sync date
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9', teal:'#2DD4BF',
}

const S = {
  input: { width:'100%', padding:'8px 12px', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, color:G.text, fontSize:13, outline:'none', boxSizing:'border-box' },
  btnP:  { padding:'9px 16px', background:G.green, color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnD:  { padding:'9px 16px', background:G.red+'22', color:G.red, border:`1px solid ${G.red}44`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  card:  { background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:18 },
  lbl:   { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.3px' },
}

const STATUS_INFO = {
  draft:      { label:'Draft',      color:G.dim,    icon:'📝' },
  activ:      { label:'Activ',      color:G.green,  icon:'✓'  },
  suspendat:  { label:'Suspendat',  color:G.yellow, icon:'⏸'  },
  finalizat:  { label:'Finalizat',  color:G.blue,   icon:'🏁' },
  reziliat:   { label:'Reziliat',   color:G.red,    icon:'⛔' },
}

const CAT_INFO = {
  executie:        { label:'Execuție',         icon:'🏗️', color:G.orange },
  prestari_servicii: { label:'Prestări servicii', icon:'🔧', color:G.blue   },
  paza:            { label:'Pază',              icon:'🛡️', color:G.purple },
  altele:          { label:'Altele',            icon:'📄', color:G.muted  },
}

const SENS_INFO = {
  incasare: { label:'Încasare', icon:'⬇', color:G.green },
  plata:    { label:'Plată',    icon:'⬆', color:G.orange },
}

const TIP_ACT_INFO = {
  prelungire: { label:'Prelungire', icon:'📅', color:G.blue   },
  majorare:   { label:'Majorare',   icon:'📈', color:G.green  },
  reducere:   { label:'Reducere',   icon:'📉', color:G.yellow },
  modificare: { label:'Modificare', icon:'✏️', color:G.purple },
  reziliere:  { label:'Reziliere',  icon:'⛔', color:G.red    },
}

const fmtLei = n => n ? new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON', maximumFractionDigits:0 }).format(n) : '—'
const fmtEur = n => n ? new Intl.NumberFormat('ro-RO', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n) : '—'
const fmtDate = s => s ? new Date(s).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'
const fmtVal = c => c.valoare_actuala_lei ? fmtLei(c.valoare_actuala_lei) : c.valoare_lei ? fmtLei(c.valoare_lei) : c.valoare_eur ? fmtEur(c.valoare_eur) : '—'
const getPartener = (c, benefMap) => c.partener_text || benefMap[c.beneficiar_id] || '—'

function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, kind='ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 4000) }
  const Toast = () => toast ? (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background: toast.kind === 'err' ? G.red : toast.kind === 'warn' ? G.yellow : G.green,
      color:'#fff', borderRadius:8, fontWeight:600, fontSize:13, zIndex:10000,
      boxShadow:'0 8px 24px rgba(0,0,0,0.4)'
    }}>{toast.msg}</div>
  ) : null
  return { show, Toast }
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function ContracteTertiTab() {
  const [subTab, setSubTab] = useState('contracte')
  const [profile, setProfile] = useState(null)
  const [beneficiari, setBeneficiari] = useState([])
  const [contracte, setContracte] = useState([])
  const [loading, setLoading] = useState(true)
  const { show, Toast } = useToast()

  const [editBen, setEditBen] = useState(null)
  const [editCon, setEditCon] = useState(null)
  const [viewCon, setViewCon] = useState(null)

  const loadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('profiles')
        .select('id, name, is_owner, can_manage_contracts').eq('id', user.id).single()
      setProfile(data)
    }
    const [bRes, cRes] = await Promise.all([
      supabase.from('beneficiari').select('*').order('nume'),
      supabase.from('contracte_terti').select('*')
        .order('data_semnare', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
    ])
    setBeneficiari(bRes.data || [])
    setContracte(cRes.data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const canWrite = profile?.is_owner === true || profile?.can_manage_contracts === true
  const isOwner  = profile?.is_owner === true

  if (loading) {
    return <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13}}>⏳ Se încarcă...</div>
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:18}}>
      {/* HERO */}
      <div style={{
        padding:'20px 24px',
        background:`linear-gradient(135deg, ${G.orange}22, ${G.surface})`,
        border:`1px solid ${G.orange}44`, borderRadius:12
      }}>
        <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap'}}>
          <span style={{fontSize:32}}>📃</span>
          <div style={{flex:1}}>
            <div style={{fontSize:20, fontWeight:800, color:G.orange}}>Contracte cu terți</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Execuție · Prestări servicii · Pază · Altele — Upload PDF + extract AI automat al clauzelor
            </div>
          </div>
          <div style={{textAlign:'right', fontSize:11, color:G.muted}}>
            <div>📊 <strong style={{color:G.text}}>{beneficiari.filter(b=>b.activ).length}</strong> beneficiari</div>
            <div>📃 <strong style={{color:G.text}}>{contracte.length}</strong> contracte</div>
          </div>
        </div>
        {!canWrite && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.yellow+'22', borderRadius:6, fontSize:11, color:G.yellow}}>
            ⚠ Poți doar vizualiza contractele. Adăugarea/editarea necesită drepturi speciale.
          </div>
        )}
        {canWrite && !isOwner && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.green+'22', borderRadius:6, fontSize:11, color:G.green}}>
            ✓ Ai acces de editare pentru contracte. Ștergerea este rezervată proprietarilor.
          </div>
        )}
      </div>

      {/* SUB-TABS */}
      <div style={{display:'flex', gap:6, padding:6, background:G.surface, borderRadius:10, border:`1px solid ${G.border}`, width:'fit-content', flexWrap:'wrap'}}>
        {[
          { key:'contracte',   icon:'📃', label:'Contracte',   count:contracte.length },
          { key:'beneficiari', icon:'🏢', label:'Beneficiari', count:beneficiari.length },
        ].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{
            padding:'9px 16px', borderRadius:7, border:'none', cursor:'pointer',
            background: subTab === t.key ? G.orange+'33' : 'transparent',
            color: subTab === t.key ? G.orange : G.muted,
            fontWeight:700, fontSize:13, display:'flex', alignItems:'center', gap:8
          }}>
            <span>{t.icon}</span> {t.label}
            <span style={{
              padding:'1px 7px', borderRadius:10, fontSize:11,
              background: subTab === t.key ? G.orange+'44' : G.border2,
              color: subTab === t.key ? G.orange : G.dim
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {subTab === 'beneficiari' && (
        <BeneficiariSubTab 
          beneficiari={beneficiari} contracte={contracte} isOwner={isOwner}
          onAdd={() => setEditBen({})}
          onEdit={b => setEditBen(b)}
          onToggleActiv={async b => {
            const { error } = await supabase.from('beneficiari').update({ activ: !b.activ }).eq('id', b.id)
            if (error) show('Eroare: ' + error.message, 'err')
            else { show(`✓ ${b.nume} ${!b.activ ? 'activat' : 'dezactivat'}`); loadAll() }
          }}
        />
      )}

      {subTab === 'contracte' && (
        <ContracteSubTab 
          contracte={contracte} beneficiari={beneficiari}
          canWrite={canWrite} isOwner={isOwner}
          onAdd={() => setEditCon({})}
          onView={c => setViewCon(c)}
          onEdit={c => setEditCon(c)}
          onDelete={async c => {
            if (!confirm(`Șterge contract „${c.denumire}"?\n\nIREVERSIBIL. PDF-ul rămâne în Storage.`)) return
            const { error } = await supabase.from('contracte_terti').delete().eq('id', c.id)
            if (error) show('Eroare: ' + error.message, 'err')
            else { show('✓ Contract șters'); loadAll() }
          }}
        />
      )}

      {editBen && (
        <BeneficiarModal
          item={editBen}
          onClose={() => setEditBen(null)}
          onSaved={() => { setEditBen(null); loadAll(); show('✓ Beneficiar salvat') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
      {editCon && (
        <ContractModal
          item={editCon} beneficiari={beneficiari}
          onClose={() => setEditCon(null)}
          onSaved={() => { setEditCon(null); loadAll(); show('✓ Contract salvat') }}
          onError={e => show('Eroare: ' + e, 'err')}
          onAiSuccess={() => { setEditCon(null); loadAll(); show('🤖 AI extract complet · contract actualizat', 'ok') }}
        />
      )}
      {viewCon && (
        <ContractDetailModal
          contract={viewCon} beneficiari={beneficiari} canWrite={canWrite} isOwner={isOwner}
          onClose={() => setViewCon(null)}
          onEdit={() => { setEditCon(viewCon); setViewCon(null) }}
          onReload={() => { loadAll() }}
        />
      )}

      <Toast />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// BENEFICIARI SUB-TAB (nemodificat față de v2)
// ══════════════════════════════════════════════════════════
function BeneficiariSubTab({ beneficiari, contracte, isOwner, onAdd, onEdit, onToggleActiv }) {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const filtered = useMemo(() => {
    let list = beneficiari
    if (!showInactive) list = list.filter(b => b.activ)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(b => (b.nume||'').toLowerCase().includes(s) || (b.cod_fiscal||'').toLowerCase().includes(s))
    }
    return list
  }, [beneficiari, search, showInactive])

  const contracteCount = id => contracte.filter(c => c.beneficiar_id === id).length

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>
      <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <input placeholder="🔍 Caută beneficiar..." style={{...S.input, flex:1, minWidth:240, maxWidth:380, boxSizing:'border-box'}}
          value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer', whiteSpace:'nowrap'}}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Afișează inactivi
        </label>
        {isOwner && <button onClick={onAdd} style={{...S.btnP, marginLeft:'auto', whiteSpace:'nowrap'}}>+ Adaugă beneficiar</button>}
      </div>
      {filtered.length === 0 ? (
        <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13, ...S.card}}>
          {search ? '🔍 Niciun rezultat' : '📭 Niciun beneficiar de afișat'}
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
          {filtered.map(b => (
            <div key={b.id} style={{...S.card, opacity: b.activ ? 1 : 0.55}}>
              <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:10}}>
                <div style={{width:40, height:40, borderRadius:8, background:G.orange+'22', border:`1px solid ${G.orange}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20}}>🏢</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:2}}>{b.nume}</div>
                  {b.cod_fiscal && <div style={{fontSize:11, color:G.dim, fontFamily:'monospace'}}>{b.cod_fiscal}</div>}
                </div>
                {!b.activ && <span style={{fontSize:10, padding:'2px 6px', background:G.red+'22', color:G.red, borderRadius:4, fontWeight:600}}>INACTIV</span>}
              </div>
              {(b.contact_email || b.telefon) && (
                <div style={{fontSize:11, color:G.dim, marginBottom:8, display:'flex', flexDirection:'column', gap:2}}>
                  {b.contact_email && <div>📧 {b.contact_email}</div>}
                  {b.telefon && <div>☎ {b.telefon}</div>}
                </div>
              )}
              <div style={{display:'flex', alignItems:'center', gap:8, paddingTop:10, borderTop:`1px solid ${G.border}`}}>
                <span style={{fontSize:11, color:G.dim}}>Contracte:</span>
                <span style={{fontSize:12, fontWeight:700, color: contracteCount(b.id) > 0 ? G.green : G.dim}}>{contracteCount(b.id)}</span>
                {isOwner && (
                  <div style={{marginLeft:'auto', display:'flex', gap:6}}>
                    <button onClick={() => onEdit(b)} style={{...S.btnS, padding:'4px 10px', fontSize:11}}>✏️</button>
                    <button onClick={() => onToggleActiv(b)} style={{...S.btnS, padding:'4px 10px', fontSize:11, color: b.activ ? G.yellow : G.green}}>{b.activ ? '⏸' : '▶'}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// CONTRACTE SUB-TAB — cu filtre categorie + sens
// ══════════════════════════════════════════════════════════
function ContracteSubTab({ contracte, beneficiari, canWrite, isOwner, onAdd, onView, onEdit, onDelete }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const [filterSens, setFilterSens] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  const benefMap = useMemo(() => Object.fromEntries(beneficiari.map(b => [b.id, b.nume])), [beneficiari])

  const filtered = useMemo(() => {
    let list = contracte
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus)
    if (filterCat   !== 'all') list = list.filter(c => c.categorie === filterCat)
    if (filterSens  !== 'all') list = list.filter(c => c.sens === filterSens)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(c =>
        (c.denumire||'').toLowerCase().includes(s) ||
        (c.numar_contract||'').toLowerCase().includes(s) ||
        (c.partener_text||'').toLowerCase().includes(s) ||
        (benefMap[c.beneficiar_id]||'').toLowerCase().includes(s)
      )
    }
    return list
  }, [contracte, search, filterStatus, filterCat, filterSens, benefMap])

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>
      {/* Filtre */}
      <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <input placeholder="🔍 Caută contract / beneficiar..." style={{...S.input, flex:1, minWidth:200, maxWidth:280, boxSizing:'border-box'}}
          value={search} onChange={e => setSearch(e.target.value)} />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{...S.input, width:'auto', minWidth:160, boxSizing:'border-box'}}>
          <option value="all">📂 Toate categoriile</option>
          {Object.entries(CAT_INFO).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={filterSens} onChange={e => setFilterSens(e.target.value)} style={{...S.input, width:'auto', minWidth:140, boxSizing:'border-box'}}>
          <option value="all">↕ Ambele sensuri</option>
          {Object.entries(SENS_INFO).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{...S.input, width:'auto', minWidth:140, boxSizing:'border-box'}}>
          <option value="all">📊 Toate statusurile</option>
          {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        {canWrite && <button onClick={onAdd} style={{...S.btnP, marginLeft:'auto', whiteSpace:'nowrap'}}>+ Contract nou</button>}
      </div>

      {filtered.length === 0 ? (
        <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13, ...S.card}}>
          {search || filterStatus !== 'all' || filterCat !== 'all' || filterSens !== 'all'
            ? '🔍 Niciun rezultat pentru filtrele alese'
            : (canWrite ? '📭 Niciun contract. Apasă „+ Contract nou".' : '📭 Niciun contract înregistrat.')}
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {filtered.map(c => {
            const si = STATUS_INFO[c.status] || STATUS_INFO.draft
            const ci = CAT_INFO[c.categorie] || CAT_INFO.altele
            const sei = SENS_INFO[c.sens] || SENS_INFO.incasare
            const isExpanded = expandedId === c.id
            return (
              <div key={c.id} style={{...S.card, padding:0, overflow:'hidden'}}>
                {/* Row principal */}
                <div style={{display:'grid', gridTemplateColumns:'auto 1fr auto auto auto auto auto', alignItems:'center', gap:0, padding:'12px 14px', cursor:'pointer'}}
                  onClick={() => onView(c)}
                  onMouseEnter={e => e.currentTarget.style.background = G.bg}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  
                  {/* Categorie */}
                  <div style={{marginRight:12, fontSize:20}} title={ci.label}>{ci.icon}</div>
                  
                  {/* Info */}
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.denumire}</div>
                    <div style={{fontSize:11, color:G.muted, marginTop:2}}>
                      {c.numar_contract && <span style={{fontFamily:'monospace'}}>{c.numar_contract} · </span>}
                      {getPartener(c, benefMap)}
                      {c.data_termen && <span> · ⏰ {fmtDate(c.data_termen)}</span>}
                    </div>
                  </div>

                  {/* Valoare */}
                  <div style={{textAlign:'right', fontSize:12, fontWeight:700, color:sei.color, marginRight:12, whiteSpace:'nowrap'}}>
                    {sei.icon} {fmtVal(c)}
                  </div>

                  {/* Status */}
                  <div style={{marginRight:8}}>
                    <span style={{padding:'3px 9px', borderRadius:12, background:si.color+'22', color:si.color, fontSize:10, fontWeight:700, whiteSpace:'nowrap'}}>
                      {si.icon} {si.label}
                    </span>
                  </div>

                  {/* AI icon */}
                  <div style={{marginRight:8, fontSize:16}} title={c.ai_extracted_at ? 'AI extras' : c.pdf_path ? 'PDF fără AI' : 'Fără PDF'}>
                    {c.ai_extracted_at ? '🤖' : c.pdf_path ? '📄' : <span style={{color:G.dim}}>—</span>}
                  </div>

                  {/* Actions */}
                  <div style={{display:'flex', gap:4}} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      title="Acte adiționale"
                      style={{...S.btnS, padding:'4px 8px', fontSize:11, color: isExpanded ? G.orange : G.muted}}
                    >📎 {isExpanded ? '▲' : '▼'}</button>
                    <button onClick={() => onView(c)} style={{...S.btnS, padding:'4px 8px', fontSize:11}}>👁</button>
                    {canWrite && <button onClick={() => onEdit(c)} style={{...S.btnS, padding:'4px 8px', fontSize:11}}>✏️</button>}
                    {isOwner  && <button onClick={() => onDelete(c)} style={{...S.btnD, padding:'4px 8px', fontSize:11}}>🗑</button>}
                  </div>
                </div>

                {/* Acte adiționale expandable */}
                {isExpanded && (
                  <ActeAditionaleSection contractId={c.id} canWrite={canWrite} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ACTE ADIȚIONALE — expandable inline
// ══════════════════════════════════════════════════════════
function ActeAditionaleSection({ contractId, canWrite }) {
  const [acte, setActe] = useState([])
  const [loading, setLoading] = useState(true)
  const [editAct, setEditAct] = useState(null)
  const [toast, setToast] = useState(null)
  const show = (msg, kind='ok') => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3500) }

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('contracte_acte_aditionale')
      .select('*').eq('contract_id', contractId).order('data_semnare', { ascending: true })
    setActe(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [contractId])

  const handleDelete = async act => {
    if (!confirm(`Șterge actul adițional „${act.numar_act}"?`)) return
    const { error } = await supabase.from('contracte_acte_aditionale').delete().eq('id', act.id)
    if (error) show('Eroare: ' + error.message, 'err')
    else { show('✓ Act șters'); load() }
  }

  return (
    <div style={{borderTop:`1px solid ${G.border}`, background:G.bg, padding:'12px 16px'}}>
      {toast && (
        <div style={{position:'fixed', bottom:24, left:24, padding:'10px 16px', background: toast.kind==='err' ? G.red : G.green, color:'#fff', borderRadius:8, fontSize:12, fontWeight:600, zIndex:10001}}>{toast.msg}</div>
      )}
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
        <span style={{fontSize:12, fontWeight:700, color:G.orange}}>📎 Acte adiționale</span>
        <span style={{fontSize:11, color:G.dim}}>({acte.length})</span>
        {canWrite && (
          <button onClick={() => setEditAct({ contract_id: contractId })}
            style={{...S.btnP, padding:'4px 12px', fontSize:11, marginLeft:'auto', background:G.orange}}>
            + Adaugă act
          </button>
        )}
      </div>

      {loading ? (
        <div style={{fontSize:11, color:G.dim}}>⏳ Se încarcă...</div>
      ) : acte.length === 0 ? (
        <div style={{fontSize:11, color:G.dim, fontStyle:'italic'}}>
          Niciun act adițional. {canWrite ? 'Apasă „+ Adaugă act" pentru a adăuga.' : ''}
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {acte.map(act => {
            const ti = TIP_ACT_INFO[act.tip] || { label:'—', icon:'📄', color:G.muted }
            return (
              <div key={act.id} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'8px 12px', background:G.surface, borderRadius:7,
                border:`1px solid ${G.border}`
              }}>
                <span title={ti.label} style={{fontSize:16, color:ti.color}}>{ti.icon}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:12, fontWeight:700, color:G.text}}>{act.numar_act}</div>
                  <div style={{fontSize:10, color:G.muted}}>
                    {fmtDate(act.data_semnare)}
                    {act.valoare_noua_lei ? ` · ${fmtLei(act.valoare_noua_lei)}` : ''}
                    {act.data_termen_noua ? ` · termen: ${fmtDate(act.data_termen_noua)}` : ''}
                    {act.observatii ? ` · ${act.observatii}` : ''}
                  </div>
                </div>
                {act.pdf_path && (
                  <button onClick={async () => {
                    const { data } = await supabase.storage.from('contracte-terti').createSignedUrl(act.pdf_path, 600)
                    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                  }} style={{...S.btnS, padding:'3px 8px', fontSize:10}}>📄 PDF</button>
                )}
                {canWrite && (
                  <>
                    <button onClick={() => setEditAct(act)} style={{...S.btnS, padding:'3px 8px', fontSize:10}}>✏️</button>
                    <button onClick={() => handleDelete(act)} style={{...S.btnD, padding:'3px 8px', fontSize:10}}>🗑</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editAct && (
        <ActAditionalModal
          item={editAct}
          onClose={() => setEditAct(null)}
          onSaved={() => { setEditAct(null); load(); show('✓ Act adițional salvat') }}
          onError={e => show('Eroare: ' + e, 'err')}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// CONTRACT MODAL — cu categorie + sens + partener_text
// ══════════════════════════════════════════════════════════
function ContractModal({ item, beneficiari, onClose, onSaved, onError, onAiSuccess }) {
  const isNew = !item.id
  const [f, setF] = useState({
    beneficiar_id: item.beneficiar_id || '',
    partener_text: item.partener_text || '',
    numar_contract: item.numar_contract || '',
    denumire: item.denumire || '',
    categorie: item.categorie || 'executie',
    sens: item.sens || 'incasare',
    valoare_lei: item.valoare_lei || '',
    valoare_eur: item.valoare_eur || '',
    data_semnare: item.data_semnare || '',
    termen_executie_zile: item.termen_executie_zile || '',
    data_termen: item.data_termen || '',
    status: item.status || 'draft',
    observatii: item.observatii || '',
    pdf_path: item.pdf_path || '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  // Mod partener: 'beneficiar' (din lista) sau 'text' (ad-hoc)
  const [partenerMode, setPartenerMode] = useState(item.partener_text ? 'text' : 'beneficiar')
  // Drag & drop PDF
  const [dragOver, setDragOver] = useState(false)
  // Link la Proiect Execuție
  const [proiecteExec, setProiecteExec]   = useState([])
  const [proiectExecId, setProiectExecId] = useState('')

  // Încarcă proiectele execuție + detectează linkul curent
  useEffect(() => {
    const loadProiecte = async () => {
      const { data } = await supabase
        .from('executie_proiecte')
        .select('id, cod_intern, nume')
        .eq('activ', true)
        .order('cod_intern')
      setProiecteExec(data || [])
      // Detectez proiectul legat de contractul curent (dacă e edit)
      if (!isNew && item.id) {
        const { data: linked } = await supabase
          .from('executie_proiecte')
          .select('id')
          .eq('contract_id', item.id)
          .maybeSingle()
        if (linked?.id) {
          setProiectExecId(String(linked.id))
        } else if (data?.length && f.categorie === 'executie' && !item.id) {
          // Smart auto-match: compară denumire contract cu cod_intern + nume proiect
          const score = (den, p) => {
            const d = den.toLowerCase()
            const kws = (p.cod_intern + ' ' + (p.nume||'')).toLowerCase().split(/[\s_\-\/]+/).filter(w=>w.length>3)
            return kws.length ? kws.filter(w=>d.includes(w)).length / kws.length : 0
          }
          const best = data.reduce((b,p) => {
            const s = score(f.denumire||'', p)
            return s > (b.score||0) ? { ...p, score: s } : b
          }, {})
          if ((best.score||0) >= 0.4) setProiectExecId(String(best.id))
        }
      }
      // Smart auto-match pentru contract NOU de tip executie
      if (isNew && data?.length && f.categorie === 'executie' && f.denumire) {
        const score = (den, p) => {
          const d = den.toLowerCase()
          const kws = (p.cod_intern + ' ' + (p.nume||'')).toLowerCase().split(/[\s_\-\/]+/).filter(w=>w.length>3)
          return kws.length ? kws.filter(w=>d.includes(w)).length / kws.length : 0
        }
        const best = data.reduce((b,p) => {
          const s = score(f.denumire, p)
          return s > (b.score||0) ? { ...p, score: s } : b
        }, {})
        if ((best.score||0) >= 0.4) setProiectExecId(String(best.id))
      }
    }
    loadProiecte()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async file => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return onError('PDF prea mare (max 20MB)')
    if (file.type !== 'application/pdf') return onError('Doar fișiere PDF')
    setUploading(true)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${item.id || 'new'}/${ts}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('contracte-terti').upload(path, file, { upsert: false })
    setUploading(false)
    if (error) return onError(`Upload eșuat: ${error.message}`)
    setF({...f, pdf_path: path})
  }

  const handleDrop = e => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleUpload(file)
  }

  const handleSaveAndAi = async (alsoAi = false) => {
    if (!f.denumire.trim()) return onError('Denumirea e obligatorie')
    if (partenerMode === 'beneficiar' && !f.beneficiar_id) return onError('Selectează beneficiar')
    if (partenerMode === 'text' && !f.partener_text.trim()) return onError('Completează partenerul')
    setSaving(true)
    const payload = {
      beneficiar_id: partenerMode === 'beneficiar' && f.beneficiar_id ? Number(f.beneficiar_id) : null,
      partener_text: partenerMode === 'text' ? f.partener_text.trim() : null,
      numar_contract: f.numar_contract.trim() || null,
      denumire: f.denumire.trim(),
      categorie: f.categorie,
      sens: f.sens,
      valoare_lei: f.valoare_lei ? Number(f.valoare_lei) : null,
      valoare_eur: f.valoare_eur ? Number(f.valoare_eur) : null,
      data_semnare: f.data_semnare || null,
      termen_executie_zile: f.termen_executie_zile ? Number(f.termen_executie_zile) : null,
      data_termen: f.data_termen || null,
      status: f.status,
      observatii: f.observatii.trim() || null,
      pdf_path: f.pdf_path || null,
    }
    let contractId = item.id
    if (isNew) {
      const { data: { user } } = await supabase.auth.getUser()
      payload.created_by = user?.id
      const { data, error } = await supabase.from('contracte_terti').insert(payload).select('id').single()
      if (error) { setSaving(false); return onError(error.message) }
      contractId = data.id
    } else {
      const { error } = await supabase.from('contracte_terti').update(payload).eq('id', item.id)
      if (error) { setSaving(false); return onError(error.message) }
    }
    setSaving(false)

    // ─── Sincronizare cu Proiect Execuție ────────────────────────────────
    if (f.categorie === 'executie' && proiectExecId) {
      // Dezleagă eventualul proiect anterior (dacă s-a schimbat selecția)
      await supabase.from('executie_proiecte')
        .update({ contract_id: null })
        .eq('contract_id', contractId)
        .neq('id', Number(proiectExecId))
      // Leagă proiectul selectat + sync date esențiale
      await supabase.from('executie_proiecte').update({
        contract_id:   contractId,
        nr_contract:   f.numar_contract.trim() || null,
        data_contract: f.data_semnare || null,
        valoare_lei:   f.valoare_lei ? Number(f.valoare_lei) : null,
        valoare_eur:   f.valoare_eur ? Number(f.valoare_eur) : null,
      }).eq('id', Number(proiectExecId))
    } else if (f.categorie === 'executie' && !proiectExecId) {
      if (!isNew) {
        // Dacă a fost golit câmpul → dezleagă proiectul anterior
        await supabase.from('executie_proiecte')
          .update({ contract_id: null })
          .eq('contract_id', contractId)
      }
      // ⚠️ Contract de execuție salvat fără proiect — avertizăm și rămânem în modal
      onError('⚠️ Contractul a fost salvat, dar nu e legat la niciun proiect de Execuție! Selectează proiectul din câmpul de mai jos și re-salvează.')
      setSaving(false)
      return
    }

    if (alsoAi && f.pdf_path) {
      setAiLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      try {
        const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/parse-contract-pdf`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contract_id: contractId, pdf_path: f.pdf_path })
        })
        const result = await resp.json()
        setAiLoading(false)
        if (!resp.ok) return onError(`AI parser eroare: ${result.error || resp.status}`)
        onAiSuccess()
      } catch (e) {
        setAiLoading(false)
        onError(`AI parser exception: ${e.message}`)
      }
    } else { onSaved() }
  }

  return (
    <ModalShell title={isNew ? '+ Contract nou' : `✏️ ${item.denumire}`} onClose={onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        {/* Categorie + Sens */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <label style={S.lbl}>Categorie</label>
            <select style={S.input} value={f.categorie} onChange={e => setF({...f, categorie:e.target.value})}>
              {Object.entries(CAT_INFO).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Sens financiar</label>
            <select style={S.input} value={f.sens} onChange={e => setF({...f, sens:e.target.value})}>
              {Object.entries(SENS_INFO).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
        </div>

        {/* Partener */}
        <div>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
            <label style={S.lbl}>Partener <span style={{color:G.red}}>*</span></label>
            <div style={{display:'flex', gap:6}}>
              <button onClick={() => setPartenerMode('beneficiar')}
                style={{padding:'2px 8px', borderRadius:5, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                  background: partenerMode==='beneficiar' ? G.orange : G.border2, color: partenerMode==='beneficiar' ? '#fff' : G.muted}}>
                Din lista
              </button>
              <button onClick={() => setPartenerMode('text')}
                style={{padding:'2px 8px', borderRadius:5, border:'none', cursor:'pointer', fontSize:10, fontWeight:700,
                  background: partenerMode==='text' ? G.orange : G.border2, color: partenerMode==='text' ? '#fff' : G.muted}}>
                Liber
              </button>
            </div>
          </div>
          {partenerMode === 'beneficiar' ? (
            <select style={S.input} value={f.beneficiar_id} onChange={e => setF({...f, beneficiar_id:e.target.value})}>
              <option value="">— Selectează din lista beneficiari —</option>
              {beneficiari.filter(b => b.activ).map(b => <option key={b.id} value={b.id}>{b.nume}</option>)}
            </select>
          ) : (
            <input style={S.input} value={f.partener_text} onChange={e => setF({...f, partener_text:e.target.value})}
              placeholder="Denumire firmă furnizor / prestator / partener ad-hoc" />
          )}
        </div>

        {/* Nr contract + Denumire */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:12}}>
          <div>
            <label style={S.lbl}>Număr contract</label>
            <input style={S.input} value={f.numar_contract} onChange={e => setF({...f, numar_contract:e.target.value})} placeholder="12345/2026" />
          </div>
          <div>
            <label style={S.lbl}>Denumire <span style={{color:G.red}}>*</span></label>
            <input style={S.input} value={f.denumire} onChange={e => setF({...f, denumire:e.target.value})} placeholder="Obiectul contractului" />
          </div>
        </div>

        {/* Valori */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <label style={S.lbl}>Valoare LEI (RON)</label>
            <input type="number" style={S.input} value={f.valoare_lei} onChange={e => setF({...f, valoare_lei:e.target.value})} placeholder="1500000" />
          </div>
          <div>
            <label style={S.lbl}>Valoare EUR</label>
            <input type="number" style={S.input} value={f.valoare_eur} onChange={e => setF({...f, valoare_eur:e.target.value})} placeholder="300000" />
          </div>
        </div>

        {/* Date */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
          <div>
            <label style={S.lbl}>Data semnare</label>
            <input type="date" style={S.input} value={f.data_semnare} onChange={e => setF({...f, data_semnare:e.target.value})} />
          </div>
          <div>
            <label style={S.lbl}>Termen (zile)</label>
            <input type="number" style={S.input} value={f.termen_executie_zile} onChange={e => setF({...f, termen_executie_zile:e.target.value})} placeholder="180" />
          </div>
          <div>
            <label style={S.lbl}>Data termen</label>
            <input type="date" style={S.input} value={f.data_termen} onChange={e => setF({...f, data_termen:e.target.value})} />
          </div>
        </div>

        <div>
          <label style={S.lbl}>Status</label>
          <select style={S.input} value={f.status} onChange={e => setF({...f, status:e.target.value})}>
            {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>

        <div>
          <label style={S.lbl}>Observații</label>
          <textarea style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})} />
        </div>

          {/* ── Proiect Execuție asociat (vizibil doar pentru categorie=executie) ── */}
        {f.categorie === 'executie' && (
          <div style={{padding:12, background:G.surface, border:`1px solid ${G.blue}33`, borderRadius:8}}>
            <label style={{...S.lbl, color:G.blue}}>🔗 Proiect Execuție asociat</label>
            <select
              value={proiectExecId}
              onChange={e => setProiectExecId(e.target.value)}
              style={S.input}
            >
              <option value="">— Neselectat —</option>
              {proiecteExec.map(p => (
                <option key={p.id} value={p.id}>{p.cod_intern} · {p.nume?.slice(0, 55)}</option>
              ))}
            </select>
            {proiectExecId ? (
              <div style={{fontSize:11, marginTop:6, display:'flex', alignItems:'center', gap:8}}>
                <span style={{color:G.blue}}>✓</span>
                <span style={{color:G.blue}}>La salvare: nr. contract, valoare și data semnare se sincronizează automat în proiect.</span>
                {proiecteExec.find(p=>String(p.id)===proiectExecId) && !isNew && (() => {
                  // Indicator auto-detectat
                  const d = (f.denumire||'').toLowerCase()
                  const p = proiecteExec.find(px=>String(px.id)===proiectExecId)
                  if (!p) return null
                  const kws = (p.cod_intern+' '+(p.nume||'')).toLowerCase().split(/[\s_\-\/]+/).filter(w=>w.length>3)
                  const s = kws.length ? Math.round(kws.filter(w=>d.includes(w)).length/kws.length*100) : 0
                  return s >= 40 ? (
                    <span style={{background:G.green+'22',color:G.green,borderRadius:8,padding:'1px 7px',fontSize:10}}>🎯 Auto-detectat {s}%</span>
                  ) : null
                })()}
              </div>
            ) : (
              <div style={{fontSize:11, color:G.dim, marginTop:6}}>
                {f.denumire?.length > 5 ? '💡 Completați denumirea contractului pentru auto-detectare proiect.' : 'Selectați proiectul pentru sincronizare automată.'}
              </div>
            )}
          </div>
        )}

        {/* ── PDF Upload cu Drag & Drop ──────────────────────────────────── */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            padding:14, background:G.bg,
            border:`2px dashed ${dragOver ? G.blue : f.pdf_path ? G.green + '88' : G.border2}`,
            borderRadius:8, transition:'border-color .15s ease',
            outline: dragOver ? `1px solid ${G.blue}44` : 'none',
          }}>
          <div style={{fontSize:12, fontWeight:700, color: dragOver ? G.blue : G.muted, marginBottom:8}}>
            📄 PDF Contract {dragOver && <span style={{fontWeight:400, color:G.blue}}>· Eliberați pentru upload</span>}
          </div>
          {f.pdf_path ? (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <span style={{fontSize:22}}>📄</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:G.green, fontWeight:600}}>✓ PDF încărcat</div>
                <div style={{fontSize:10, color:G.dim, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.pdf_path}</div>
              </div>
              <button onClick={() => setF({...f, pdf_path:''})} style={{...S.btnS, padding:'4px 10px', fontSize:11, color:G.red}}>✕</button>
            </div>
          ) : (
            <div>
              <label style={{
                display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer',
                padding:'8px 16px', background: G.surface, border:`1px solid ${G.border2}`,
                borderRadius:7, fontSize:13, color:G.text, fontWeight:600,
              }}>
                📎 Alege fișier
                <input type="file" accept="application/pdf" onChange={e => handleUpload(e.target.files?.[0])} disabled={uploading} style={{display:'none'}} />
              </label>
              <span style={{fontSize:11, color:G.dim, marginLeft:12}}>
                {uploading ? '⏳ Upload...' : 'sau trage PDF-ul direct aici · Max 20MB'}
              </span>
            </div>
          )}
        </div>

        {/* Butoane */}
        <div style={{display:'flex', gap:10, marginTop:6}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={() => handleSaveAndAi(false)} disabled={saving||uploading||aiLoading}
            style={{...S.btnP, flex:1.5, background:G.surface, color:G.text, border:`1px solid ${G.border2}`, opacity:(saving||uploading||aiLoading)?0.6:1}}>
            {saving ? '⏳...' : '✓ Salvează'}
          </button>
          <button onClick={() => handleSaveAndAi(true)} disabled={saving||uploading||aiLoading||!f.pdf_path}
            style={{...S.btnP, flex:1.5, background:G.purple, opacity:(!f.pdf_path||saving||uploading||aiLoading)?0.6:1}}
            title={!f.pdf_path ? 'Încarcă întâi PDF' : 'Salvează + extrage cu Claude AI'}>
            {aiLoading ? '🤖 AI extrage...' : '🤖 Salvează + Extract AI'}
          </button>
        </div>
        {aiLoading && (
          <div style={{padding:10, background:G.purple+'22', borderRadius:6, fontSize:11, color:G.purple, textAlign:'center'}}>
            ⏳ Claude analizează PDF-ul... (10-30 secunde)
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ══════════════════════════════════════════════════════════
// ACT ADIȚIONAL MODAL
// ══════════════════════════════════════════════════════════
function ActAditionalModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    numar_act: item.numar_act || '',
    data_semnare: item.data_semnare || '',
    tip: item.tip || 'modificare',
    valoare_noua_lei: item.valoare_noua_lei || '',
    valoare_noua_eur: item.valoare_noua_eur || '',
    durata_noua_zile: item.durata_noua_zile || '',
    data_termen_noua: item.data_termen_noua || '',
    observatii: item.observatii || '',
    pdf_path: item.pdf_path || '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async file => {
    if (!file || file.size > 20*1024*1024 || file.type !== 'application/pdf') return onError('PDF max 20MB')
    setUploading(true)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `acte/${item.contract_id}/${ts}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('contracte-terti').upload(path, file, { upsert: false })
    setUploading(false)
    if (error) return onError(`Upload eșuat: ${error.message}`)
    setF({...f, pdf_path: path})
  }

  const handleSave = async () => {
    if (!f.numar_act.trim()) return onError('Numărul actului e obligatoriu')
    setSaving(true)
    const payload = {
      contract_id: item.contract_id,
      numar_act: f.numar_act.trim(),
      data_semnare: f.data_semnare || null,
      tip: f.tip || null,
      valoare_noua_lei: f.valoare_noua_lei ? Number(f.valoare_noua_lei) : null,
      valoare_noua_eur: f.valoare_noua_eur ? Number(f.valoare_noua_eur) : null,
      durata_noua_zile: f.durata_noua_zile ? Number(f.durata_noua_zile) : null,
      data_termen_noua: f.data_termen_noua || null,
      observatii: f.observatii.trim() || null,
      pdf_path: f.pdf_path || null,
    }
    const { error } = isNew
      ? await supabase.from('contracte_acte_aditionale').insert(payload)
      : await supabase.from('contracte_acte_aditionale').update(payload).eq('id', item.id)
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <ModalShell title={isNew ? '+ Act adițional nou' : `✏️ ${item.numar_act}`} onClose={onClose}>
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <label style={S.lbl}>Număr act *</label>
            <input style={S.input} value={f.numar_act} onChange={e => setF({...f, numar_act:e.target.value})} placeholder="Act. 1/2026" autoFocus />
          </div>
          <div>
            <label style={S.lbl}>Tip</label>
            <select style={S.input} value={f.tip} onChange={e => setF({...f, tip:e.target.value})}>
              {Object.entries(TIP_ACT_INFO).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={S.lbl}>Data semnare</label>
          <input type="date" style={S.input} value={f.data_semnare} onChange={e => setF({...f, data_semnare:e.target.value})} />
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div>
            <label style={S.lbl}>Valoare nouă LEI</label>
            <input type="number" style={S.input} value={f.valoare_noua_lei} onChange={e => setF({...f, valoare_noua_lei:e.target.value})} placeholder="0" />
          </div>
          <div>
            <label style={S.lbl}>Durată nouă (zile)</label>
            <input type="number" style={S.input} value={f.durata_noua_zile} onChange={e => setF({...f, durata_noua_zile:e.target.value})} placeholder="90" />
          </div>
        </div>
        <div>
          <label style={S.lbl}>Termen nou</label>
          <input type="date" style={S.input} value={f.data_termen_noua} onChange={e => setF({...f, data_termen_noua:e.target.value})} />
        </div>
        <div>
          <label style={S.lbl}>Observații</label>
          <textarea style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})} />
        </div>
        {/* PDF */}
        <div style={{padding:10, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:7}}>
          <div style={{fontSize:11, fontWeight:700, color:G.muted, marginBottom:6}}>📄 PDF Act adițional</div>
          {f.pdf_path ? (
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <span style={{color:G.green, fontSize:12}}>✓ {f.pdf_path.split('/').pop()}</span>
              <button onClick={() => setF({...f, pdf_path:''})} style={{...S.btnS, padding:'3px 8px', fontSize:10, color:G.red}}>✕</button>
            </div>
          ) : (
            <input type="file" accept="application/pdf" onChange={e => handleUpload(e.target.files?.[0])} disabled={uploading} style={{fontSize:11, color:G.muted}} />
          )}
          {uploading && <div style={{fontSize:10, color:G.dim, marginTop:4}}>⏳ Upload...</div>}
        </div>
        <div style={{display:'flex', gap:10}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={handleSave} disabled={saving||uploading} style={{...S.btnP, flex:2, opacity:(saving||uploading)?0.6:1}}>
            {saving ? '⏳...' : isNew ? '+ Adaugă act' : '✓ Salvează'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ══════════════════════════════════════════════════════════
// CONTRACT DETAIL MODAL — cu categorie + sens + acte aditionale
// ══════════════════════════════════════════════════════════
function ContractDetailModal({ contract, beneficiari, canWrite, isOwner, onClose, onEdit }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const benefMap = Object.fromEntries(beneficiari.map(b => [b.id, b.nume]))
  const si = STATUS_INFO[contract.status] || STATUS_INFO.draft
  const ci = CAT_INFO[contract.categorie] || CAT_INFO.altele
  const sei = SENS_INFO[contract.sens] || SENS_INFO.incasare
  const clauze = contract.ai_clauze_jsonb || {}
  const subClauze = clauze.clauze || {}

  useEffect(() => {
    if (contract.pdf_path) {
      supabase.storage.from('contracte-terti').createSignedUrl(contract.pdf_path, 600)
        .then(({ data }) => setPdfUrl(data?.signedUrl))
    }
  }, [contract.pdf_path])

  return (
    <ModalShell title={contract.denumire} onClose={onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:16}}>
        {/* Badges */}
        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
          <span style={{padding:'4px 10px', borderRadius:14, background:ci.color+'22', color:ci.color, fontSize:11, fontWeight:700}}>{ci.icon} {ci.label}</span>
          <span style={{padding:'4px 10px', borderRadius:14, background:sei.color+'22', color:sei.color, fontSize:11, fontWeight:700}}>{sei.icon} {sei.label}</span>
          <span style={{padding:'4px 10px', borderRadius:14, background:si.color+'22', color:si.color, fontSize:11, fontWeight:700}}>{si.icon} {si.label}</span>
          {contract.numar_contract && <span style={{fontSize:11, color:G.muted, fontFamily:'monospace'}}>📄 {contract.numar_contract}</span>}
          <div style={{flex:1}} />
          {canWrite && <button onClick={onEdit} style={{...S.btnS, padding:'6px 12px', fontSize:12}}>✏️ Editează</button>}
        </div>

        {/* Grid info */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          {[
            ['🏢 Partener', getPartener(contract, benefMap)],
            ['💰 Valoare', fmtVal(contract)],
            ['📅 Data semnare', fmtDate(contract.data_semnare)],
            ['📅 Data termen', fmtDate(contract.data_termen)],
            ['⏱ Termen execuție', contract.termen_executie_zile ? `${contract.termen_executie_zile} zile` : '—'],
            ['🤖 Extract AI', contract.ai_extracted_at ? fmtDate(contract.ai_extracted_at) : 'Neaplicat'],
          ].map(([lbl, val]) => (
            <div key={lbl} style={{background:G.bg, borderRadius:7, padding:'8px 12px'}}>
              <div style={{fontSize:10, color:G.muted, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:2}}>{lbl}</div>
              <div style={{fontSize:13, fontWeight:600, color:G.text}}>{val}</div>
            </div>
          ))}
        </div>

        {contract.observatii && (
          <div style={{...S.card, background:G.bg, padding:'10px 14px'}}>
            <div style={S.lbl}>📝 Observații</div>
            <div style={{fontSize:13, color:G.text, lineHeight:1.5}}>{contract.observatii}</div>
          </div>
        )}

        {/* AI extras */}
        {contract.ai_extracted_at && (
          <div style={{padding:14, background:G.purple+'11', border:`1px solid ${G.purple}44`, borderRadius:10}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:10}}>
              <span style={{fontSize:16}}>🤖</span>
              <span style={{fontSize:13, fontWeight:700, color:G.purple}}>Clauze extrase de Claude AI</span>
              {clauze.confidence && <span style={{marginLeft:'auto', padding:'2px 8px', background:G.purple+'22', borderRadius:10, fontSize:10, color:G.purple, fontWeight:700}}>Confidence: {clauze.confidence}%</span>}
            </div>
            {[['⚠', 'Penalități', subClauze.penalitati], ['🛡', 'Garanții', subClauze.garantii], ['💰', 'Plată', subClauze.plata], ['⛔', 'Reziliere', subClauze.reziliere], ['📌', 'Alte clauze', subClauze.observatii]]
              .filter(([,, val]) => val)
              .map(([icon, lbl, val]) => (
                <div key={lbl} style={{padding:'7px 12px', background:G.surface, borderRadius:6, marginBottom:6}}>
                  <div style={{fontSize:10, fontWeight:700, color:G.purple, marginBottom:2}}>{icon} {lbl}</div>
                  <div style={{fontSize:12, color:G.text, lineHeight:1.5}}>{val}</div>
                </div>
              ))
            }
          </div>
        )}

        {/* Acte adiționale în detail modal */}
        <ActeAditionaleSection contractId={contract.id} canWrite={canWrite} />

        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            display:'inline-flex', alignItems:'center', gap:8, padding:'10px 14px',
            background:G.blue+'22', color:G.blue, textDecoration:'none',
            borderRadius:8, fontSize:13, fontWeight:600, border:`1px solid ${G.blue}44`, justifyContent:'center'
          }}>📄 Deschide PDF în tab nou</a>
        )}

        <button onClick={onClose} style={{...S.btnS, marginTop:4}}>Închide</button>
      </div>
    </ModalShell>
  )
}

// ══════════════════════════════════════════════════════════
// BENEFICIAR MODAL (nemodificat)
// ══════════════════════════════════════════════════════════
function BeneficiarModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({ nume:item.nume||'', cod_fiscal:item.cod_fiscal||'', adresa:item.adresa||'', contact_email:item.contact_email||'', telefon:item.telefon||'', observatii:item.observatii||'', activ:item.activ!==false })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!f.nume.trim()) return onError('Numele e obligatoriu')
    setSaving(true)
    const payload = { nume:f.nume.trim(), cod_fiscal:f.cod_fiscal.trim()||null, adresa:f.adresa.trim()||null, contact_email:f.contact_email.trim()||null, telefon:f.telefon.trim()||null, observatii:f.observatii.trim()||null, activ:f.activ }
    const { error } = isNew ? await supabase.from('beneficiari').insert(payload) : await supabase.from('beneficiari').update(payload).eq('id', item.id)
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <ModalShell title={isNew ? '+ Adaugă beneficiar' : `✏️ ${item.nume}`} onClose={onClose}>
      <div style={{display:'flex', flexDirection:'column', gap:12}}>
        <div><label style={S.lbl}>Nume *</label><input style={S.input} value={f.nume} onChange={e => setF({...f,nume:e.target.value})} autoFocus /></div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <div><label style={S.lbl}>Cod fiscal</label><input style={S.input} value={f.cod_fiscal} onChange={e => setF({...f,cod_fiscal:e.target.value})} placeholder="RO12345678" /></div>
          <div><label style={S.lbl}>Telefon</label><input style={S.input} value={f.telefon} onChange={e => setF({...f,telefon:e.target.value})} /></div>
        </div>
        <div><label style={S.lbl}>Email contact</label><input style={S.input} type="email" value={f.contact_email} onChange={e => setF({...f,contact_email:e.target.value})} /></div>
        <div><label style={S.lbl}>Adresă</label><input style={S.input} value={f.adresa} onChange={e => setF({...f,adresa:e.target.value})} /></div>
        <div><label style={S.lbl}>Observații</label><textarea style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f,observatii:e.target.value})} /></div>
        <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
          <input type="checkbox" checked={f.activ} onChange={e => setF({...f,activ:e.target.checked})} style={{accentColor:G.green}} />
          <span style={{fontSize:13, color:G.text, fontWeight:600}}>Beneficiar activ</span>
        </label>
        <div style={{display:'flex', gap:10}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, flex:2, opacity:saving?0.6:1}}>{saving ? '⏳...' : isNew ? '+ Adaugă' : '✓ Salvează'}</button>
        </div>
      </div>
    </ModalShell>
  )
}

// ══════════════════════════════════════════════════════════
// MODAL SHELL
// ══════════════════════════════════════════════════════════
function ModalShell({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14, width:'100%', maxWidth: wide ? 720 : 480, maxHeight:'90vh', overflow:'auto', padding:'22px 26px', boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
          <div style={{fontSize:17, fontWeight:800, color:G.text}}>{title}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', padding:0, lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
