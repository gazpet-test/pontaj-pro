// ════════════════════════════════════════════════════════════════
// ContracteTertiTab.jsx — Sub-tab Administrativ „Contracte cu terți"
// v2 LIVE 19.05.2026 (Etapa 15 Faza 2 — CRUD funcțional + AI parser)
//
// Features:
// - 2 sub-tab-uri: 🏢 Beneficiari + 📃 Contracte
// - CRUD Beneficiari complet (Add/Edit/Toggle activ)
// - CRUD Contracte cu upload PDF în bucket privat contracte-terti
// - Buton „🤖 Extract cu AI" → Edge Function parse-contract-pdf
// - Display extras AI (clauze: penalități, garanții, plată, reziliere)
// - Permisiuni: doar OWNER (Razvan + Marilena) pot adăuga/edita
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9'
}

const S = {
  input: { width:'100%', padding:'8px 12px', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, color:G.text, fontSize:13, outline:'none' },
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

const fmtLei = (n) => n ? new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON', maximumFractionDigits:0 }).format(n) : '—'
const fmtEur = (n) => n ? new Intl.NumberFormat('ro-RO', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n) : '—'
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric' }) : '—'

// Toast simplu
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

export default function ContracteTertiTab() {
  const [subTab, setSubTab] = useState('beneficiari')
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
      const { data } = await supabase.from('profiles').select('id, name, is_owner').eq('id', user.id).single()
      setProfile(data)
    }
    const [bRes, cRes] = await Promise.all([
      supabase.from('beneficiari').select('*').order('nume'),
      supabase.from('contracte_terti').select('*').order('data_semnare', { ascending: false, nullsFirst: false }).order('id', { ascending: false })
    ])
    setBeneficiari(bRes.data || [])
    setContracte(cRes.data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const isOwner = profile?.is_owner === true

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
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <span style={{fontSize:32}}>📃</span>
          <div style={{flex:1}}>
            <div style={{fontSize:20, fontWeight:800, color:G.orange}}>Contracte cu terți</div>
            <div style={{fontSize:12, color:G.muted, marginTop:2}}>
              Contracte de lucrări per beneficiar · Upload PDF + extract AI automat al clauzelor
            </div>
          </div>
          <div style={{textAlign:'right', fontSize:11, color:G.muted}}>
            <div>📊 <strong style={{color:G.text}}>{beneficiari.filter(b=>b.activ).length}</strong> beneficiari</div>
            <div>📃 <strong style={{color:G.text}}>{contracte.length}</strong> contracte</div>
          </div>
        </div>
        {!isOwner && (
          <div style={{marginTop:12, padding:'8px 12px', background:G.yellow+'22', borderRadius:6, fontSize:11, color:G.yellow}}>
            ⚠ Doar owner-ii (Razvan + Marilena) pot adăuga / edita contracte. Tu poți doar vizualiza.
          </div>
        )}
      </div>

      {/* SUB-TABS */}
      <div style={{display:'flex', gap:6, padding:6, background:G.surface, borderRadius:10, border:`1px solid ${G.border}`, width:'fit-content'}}>
        {[
          { key:'beneficiari', icon:'🏢', label:'Beneficiari', count:beneficiari.length },
          { key:'contracte',   icon:'📃', label:'Contracte',   count:contracte.length },
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

      {/* CONTENT */}
      {subTab === 'beneficiari' && (
        <BeneficiariSubTab 
          beneficiari={beneficiari}
          contracte={contracte}
          isOwner={isOwner}
          onAdd={() => setEditBen({})}
          onEdit={(b) => setEditBen(b)}
          onToggleActiv={async (b) => {
            const { error } = await supabase.from('beneficiari').update({ activ: !b.activ }).eq('id', b.id)
            if (error) show('Eroare: ' + error.message, 'err')
            else { show(`✓ ${b.nume} ${!b.activ ? 'activat' : 'dezactivat'}`); loadAll() }
          }}
        />
      )}

      {subTab === 'contracte' && (
        <ContracteSubTab 
          contracte={contracte}
          beneficiari={beneficiari}
          isOwner={isOwner}
          onAdd={() => setEditCon({})}
          onView={(c) => setViewCon(c)}
          onEdit={(c) => setEditCon(c)}
          onDelete={async (c) => {
            if (!confirm(`Șterge contract „${c.denumire}"?\n\nIREVERSIBIL. PDF-ul rămâne în Storage.`)) return
            const { error } = await supabase.from('contracte_terti').delete().eq('id', c.id)
            if (error) show('Eroare: ' + error.message, 'err')
            else { show('✓ Contract șters'); loadAll() }
          }}
        />
      )}

      {/* MODALE */}
      {editBen && (
        <BeneficiarModal
          item={editBen}
          onClose={() => setEditBen(null)}
          onSaved={() => { setEditBen(null); loadAll(); show('✓ Beneficiar salvat') }}
          onError={(e) => show('Eroare: ' + e, 'err')}
        />
      )}
      {editCon && (
        <ContractModal
          item={editCon}
          beneficiari={beneficiari}
          onClose={() => setEditCon(null)}
          onSaved={() => { setEditCon(null); loadAll(); show('✓ Contract salvat') }}
          onError={(e) => show('Eroare: ' + e, 'err')}
          onAiSuccess={() => { setEditCon(null); loadAll(); show('🤖 AI extract complet · contract actualizat', 'ok') }}
        />
      )}
      {viewCon && (
        <ContractDetailModal
          contract={viewCon}
          beneficiari={beneficiari}
          onClose={() => setViewCon(null)}
          onEdit={() => { setEditCon(viewCon); setViewCon(null) }}
        />
      )}

      <Toast />
    </div>
  )
}

// ───────────────────────────── BENEFICIARI ─────────────────────────────
function BeneficiariSubTab({ beneficiari, contracte, isOwner, onAdd, onEdit, onToggleActiv }) {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const filtered = useMemo(() => {
    let list = beneficiari
    if (!showInactive) list = list.filter(b => b.activ)
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(b => 
        (b.nume || '').toLowerCase().includes(s) ||
        (b.cod_fiscal || '').toLowerCase().includes(s) ||
        (b.observatii || '').toLowerCase().includes(s)
      )
    }
    return list
  }, [beneficiari, search, showInactive])

  const contracteCount = (id) => contracte.filter(c => c.beneficiar_id === id).length

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>
      <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <input
          placeholder="🔍 Caută beneficiar..."
          style={{...S.input, flex:1, minWidth:240, maxWidth:380}}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, cursor:'pointer'}}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Afișează inactivi
        </label>
        {isOwner && (
          <button onClick={onAdd} style={{...S.btnP, marginLeft:'auto'}}>+ Adaugă beneficiar</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13, ...S.card}}>
          {search ? '🔍 Niciun rezultat pentru căutare' : '📭 Niciun beneficiar de afișat'}
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
          {filtered.map(b => (
            <div key={b.id} style={{
              ...S.card,
              opacity: b.activ ? 1 : 0.55,
              transition:'opacity 0.2s'
            }}>
              <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:10}}>
                <div style={{
                  width:40, height:40, borderRadius:8,
                  background:G.orange+'22', border:`1px solid ${G.orange}44`,
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:20
                }}>🏢</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:14, fontWeight:700, color:G.text, marginBottom:2}}>{b.nume}</div>
                  {b.cod_fiscal && (
                    <div style={{fontSize:11, color:G.dim, fontFamily:'monospace'}}>{b.cod_fiscal}</div>
                  )}
                </div>
                {!b.activ && <span style={{fontSize:10, padding:'2px 6px', background:G.red+'22', color:G.red, borderRadius:4, fontWeight:600}}>INACTIV</span>}
              </div>
              {b.observatii && (
                <div style={{fontSize:11, color:G.muted, lineHeight:1.5, marginBottom:10, fontStyle:'italic'}}>
                  {b.observatii}
                </div>
              )}
              {(b.contact_email || b.telefon || b.adresa) && (
                <div style={{fontSize:11, color:G.dim, marginBottom:10, display:'flex', flexDirection:'column', gap:3}}>
                  {b.contact_email && <div>📧 {b.contact_email}</div>}
                  {b.telefon && <div>☎ {b.telefon}</div>}
                  {b.adresa && <div>📍 {b.adresa}</div>}
                </div>
              )}
              <div style={{
                display:'flex', alignItems:'center', gap:8, paddingTop:10,
                borderTop:`1px solid ${G.border}`
              }}>
                <span style={{fontSize:11, color:G.dim}}>Contracte:</span>
                <span style={{fontSize:12, fontWeight:700, color: contracteCount(b.id) > 0 ? G.green : G.dim}}>
                  {contracteCount(b.id)}
                </span>
                {isOwner && (
                  <div style={{marginLeft:'auto', display:'flex', gap:6}}>
                    <button onClick={() => onEdit(b)} style={{...S.btnS, padding:'4px 10px', fontSize:11}}>✏️ Edit</button>
                    <button onClick={() => onToggleActiv(b)} style={{...S.btnS, padding:'4px 10px', fontSize:11, color: b.activ ? G.yellow : G.green}}>
                      {b.activ ? '⏸' : '▶'}
                    </button>
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

// ───────────────────────────── CONTRACTE ─────────────────────────────
function ContracteSubTab({ contracte, beneficiari, isOwner, onAdd, onView, onEdit, onDelete }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterBenef, setFilterBenef] = useState('all')

  const benefMap = useMemo(() => Object.fromEntries(beneficiari.map(b => [b.id, b.nume])), [beneficiari])

  const filtered = useMemo(() => {
    let list = contracte
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus)
    if (filterBenef !== 'all') list = list.filter(c => c.beneficiar_id === Number(filterBenef))
    if (search.trim()) {
      const s = search.toLowerCase()
      list = list.filter(c =>
        (c.denumire || '').toLowerCase().includes(s) ||
        (c.numar_contract || '').toLowerCase().includes(s) ||
        (benefMap[c.beneficiar_id] || '').toLowerCase().includes(s)
      )
    }
    return list
  }, [contracte, search, filterStatus, filterBenef, benefMap])

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>
      <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <input
          placeholder="🔍 Caută contract..."
          style={{...S.input, flex:1, minWidth:200, maxWidth:300}}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{...S.input, width:'auto', minWidth:140}}>
          <option value="all">📊 Toate statusurile</option>
          {Object.entries(STATUS_INFO).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select value={filterBenef} onChange={e => setFilterBenef(e.target.value)} style={{...S.input, width:'auto', minWidth:160}}>
          <option value="all">🏢 Toți beneficiarii</option>
          {beneficiari.filter(b => b.activ).map(b => (
            <option key={b.id} value={b.id}>{b.nume}</option>
          ))}
        </select>
        {isOwner && (
          <button onClick={onAdd} style={{...S.btnP, marginLeft:'auto'}}>+ Contract nou</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:13, ...S.card}}>
          {search || filterStatus !== 'all' || filterBenef !== 'all'
            ? '🔍 Niciun rezultat pentru filtrele alese'
            : '📭 Niciun contract încă. Apasă „+ Contract nou" pentru a adăuga.'}
        </div>
      ) : (
        <div style={{...S.card, padding:0, overflow:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr style={{background:G.bg, borderBottom:`1px solid ${G.border}`}}>
                <th style={{padding:'12px 14px', textAlign:'left', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Nr.</th>
                <th style={{padding:'12px 14px', textAlign:'left', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Denumire</th>
                <th style={{padding:'12px 14px', textAlign:'left', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Beneficiar</th>
                <th style={{padding:'12px 14px', textAlign:'right', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Valoare</th>
                <th style={{padding:'12px 14px', textAlign:'left', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Termen</th>
                <th style={{padding:'12px 14px', textAlign:'center', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>Status</th>
                <th style={{padding:'12px 14px', textAlign:'center', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}>AI</th>
                <th style={{padding:'12px 14px', textAlign:'right', color:G.muted, fontSize:11, fontWeight:700, textTransform:'uppercase'}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const si = STATUS_INFO[c.status] || STATUS_INFO.draft
                return (
                  <tr key={c.id} style={{borderBottom:`1px solid ${G.border}`, cursor:'pointer'}}
                      onClick={() => onView(c)}
                      onMouseEnter={e => e.currentTarget.style.background = G.bg}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{padding:'12px 14px', color:G.dim, fontFamily:'monospace', fontSize:11}}>{c.numar_contract || `#${c.id}`}</td>
                    <td style={{padding:'12px 14px', color:G.text, fontWeight:600}}>{c.denumire}</td>
                    <td style={{padding:'12px 14px', color:G.muted}}>{benefMap[c.beneficiar_id] || '—'}</td>
                    <td style={{padding:'12px 14px', textAlign:'right', color:G.text, fontVariantNumeric:'tabular-nums', fontSize:11}}>
                      {c.valoare_lei ? fmtLei(c.valoare_lei) : c.valoare_eur ? fmtEur(c.valoare_eur) : '—'}
                    </td>
                    <td style={{padding:'12px 14px', color:G.muted, fontSize:11}}>{fmtDate(c.data_termen)}</td>
                    <td style={{padding:'12px 14px', textAlign:'center'}}>
                      <span style={{padding:'3px 9px', borderRadius:12, background:si.color+'22', color:si.color, fontSize:10, fontWeight:700}}>
                        {si.icon} {si.label}
                      </span>
                    </td>
                    <td style={{padding:'12px 14px', textAlign:'center'}}>
                      {c.ai_extracted_at ? (
                        <span title={`Extras AI la ${fmtDate(c.ai_extracted_at)}`} style={{color:G.purple, fontSize:14}}>🤖</span>
                      ) : c.pdf_path ? (
                        <span title="PDF încărcat, AI încă neaplicat" style={{color:G.dim, fontSize:14}}>📄</span>
                      ) : (
                        <span title="Fără PDF" style={{color:G.dim, fontSize:14}}>—</span>
                      )}
                    </td>
                    <td style={{padding:'12px 14px', textAlign:'right'}} onClick={e => e.stopPropagation()}>
                      <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                        <button onClick={() => onView(c)} style={{...S.btnS, padding:'4px 8px', fontSize:11}} title="Vezi detalii">👁</button>
                        {isOwner && (
                          <>
                            <button onClick={() => onEdit(c)} style={{...S.btnS, padding:'4px 8px', fontSize:11}} title="Editează">✏️</button>
                            <button onClick={() => onDelete(c)} style={{...S.btnD, padding:'4px 8px', fontSize:11}} title="Șterge">🗑</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── MODALE ─────────────────────────────
function BeneficiarModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.id
  const [f, setF] = useState({
    nume: item.nume || '',
    cod_fiscal: item.cod_fiscal || '',
    adresa: item.adresa || '',
    contact_email: item.contact_email || '',
    telefon: item.telefon || '',
    observatii: item.observatii || '',
    activ: item.activ !== false,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!f.nume.trim()) return onError('Numele e obligatoriu')
    setSaving(true)
    const payload = {
      nume: f.nume.trim(),
      cod_fiscal: f.cod_fiscal.trim() || null,
      adresa: f.adresa.trim() || null,
      contact_email: f.contact_email.trim() || null,
      telefon: f.telefon.trim() || null,
      observatii: f.observatii.trim() || null,
      activ: f.activ,
    }
    const { error } = isNew
      ? await supabase.from('beneficiari').insert(payload)
      : await supabase.from('beneficiari').update(payload).eq('id', item.id)
    setSaving(false)
    if (error) onError(error.message)
    else onSaved()
  }

  return (
    <ModalShell title={isNew ? '+ Adaugă beneficiar' : `✏️ Editează: ${item.nume}`} onClose={onClose}>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <div>
          <label style={S.lbl}>Nume <span style={{color:G.red}}>*</span></label>
          <input style={S.input} value={f.nume} onChange={e => setF({...f, nume:e.target.value})} placeholder="ex: Transgaz" autoFocus />
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Cod fiscal</label>
            <input style={S.input} value={f.cod_fiscal} onChange={e => setF({...f, cod_fiscal:e.target.value})} placeholder="RO12345678" />
          </div>
          <div>
            <label style={S.lbl}>Telefon</label>
            <input style={S.input} value={f.telefon} onChange={e => setF({...f, telefon:e.target.value})} placeholder="+40 21 234 5678" />
          </div>
        </div>
        <div>
          <label style={S.lbl}>Email contact</label>
          <input style={S.input} type="email" value={f.contact_email} onChange={e => setF({...f, contact_email:e.target.value})} placeholder="contracte@beneficiar.ro" />
        </div>
        <div>
          <label style={S.lbl}>Adresă</label>
          <input style={S.input} value={f.adresa} onChange={e => setF({...f, adresa:e.target.value})} placeholder="Adresă completă" />
        </div>
        <div>
          <label style={S.lbl}>Observații</label>
          <textarea style={{...S.input, minHeight:60, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})} placeholder="Note interne..." />
        </div>
        <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer'}}>
          <input type="checkbox" checked={f.activ} onChange={e => setF({...f, activ:e.target.checked})} style={{width:16, height:16, accentColor:G.green}} />
          <span style={{fontSize:13, color:G.text, fontWeight:600}}>Beneficiar activ</span>
        </label>
        <div style={{display:'flex', gap:10, marginTop:8}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{...S.btnP, flex:2, opacity: saving ? 0.6 : 1}}>
            {saving ? '⏳ Se salvează...' : isNew ? '+ Adaugă' : '✓ Salvează modificări'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ContractModal({ item, beneficiari, onClose, onSaved, onError, onAiSuccess }) {
  const isNew = !item.id
  const [f, setF] = useState({
    beneficiar_id: item.beneficiar_id || '',
    numar_contract: item.numar_contract || '',
    denumire: item.denumire || '',
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

  const handleUpload = async (file) => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return onError('PDF prea mare (max 20MB)')
    if (file.type !== 'application/pdf') return onError('Doar fișiere PDF acceptate')
    setUploading(true)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${item.id || 'new'}/${ts}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error } = await supabase.storage.from('contracte-terti').upload(path, file, { upsert: false })
    setUploading(false)
    if (error) return onError(`Upload eșuat: ${error.message}`)
    setF({...f, pdf_path: path})
  }

  const handleSaveAndAi = async (alsoAi = false) => {
    if (!f.denumire.trim()) return onError('Denumirea e obligatorie')
    if (!f.beneficiar_id) return onError('Selectează beneficiar')
    setSaving(true)
    const payload = {
      beneficiar_id: Number(f.beneficiar_id),
      numar_contract: f.numar_contract.trim() || null,
      denumire: f.denumire.trim(),
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
    
    if (alsoAi && f.pdf_path) {
      setAiLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      try {
        const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/parse-contract-pdf`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
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
    } else {
      onSaved()
    }
  }

  return (
    <ModalShell title={isNew ? '+ Contract nou' : `✏️ ${item.denumire}`} onClose={onClose} wide>
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Beneficiar <span style={{color:G.red}}>*</span></label>
            <select style={S.input} value={f.beneficiar_id} onChange={e => setF({...f, beneficiar_id:e.target.value})}>
              <option value="">— Selectează —</option>
              {beneficiari.filter(b => b.activ).map(b => (
                <option key={b.id} value={b.id}>{b.nume}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Număr contract</label>
            <input style={S.input} value={f.numar_contract} onChange={e => setF({...f, numar_contract:e.target.value})} placeholder="ex: 12345/2026" />
          </div>
        </div>
        <div>
          <label style={S.lbl}>Denumire <span style={{color:G.red}}>*</span></label>
          <input style={S.input} value={f.denumire} onChange={e => setF({...f, denumire:e.target.value})} placeholder="Obiectul contractului" autoFocus />
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
          <div>
            <label style={S.lbl}>Valoare LEI (RON)</label>
            <input type="number" style={S.input} value={f.valoare_lei} onChange={e => setF({...f, valoare_lei:e.target.value})} placeholder="1500000" />
          </div>
          <div>
            <label style={S.lbl}>Valoare EUR</label>
            <input type="number" style={S.input} value={f.valoare_eur} onChange={e => setF({...f, valoare_eur:e.target.value})} placeholder="300000" />
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14}}>
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
            {Object.entries(STATUS_INFO).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={S.lbl}>Observații</label>
          <textarea style={{...S.input, minHeight:50, fontFamily:'inherit', resize:'vertical'}} value={f.observatii} onChange={e => setF({...f, observatii:e.target.value})} />
        </div>

        {/* PDF UPLOAD ZONE */}
        <div style={{padding:16, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:8}}>
          <div style={{fontSize:12, fontWeight:700, color:G.muted, marginBottom:10}}>📄 PDF Contract</div>
          {f.pdf_path ? (
            <div style={{display:'flex', alignItems:'center', gap:10}}>
              <span style={{fontSize:24}}>📄</span>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, color:G.green, fontWeight:600}}>✓ PDF încărcat</div>
                <div style={{fontSize:10, color:G.dim, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.pdf_path}</div>
              </div>
              <button onClick={() => setF({...f, pdf_path:''})} style={{...S.btnS, padding:'4px 10px', fontSize:11, color:G.red}}>✕</button>
            </div>
          ) : (
            <div>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => handleUpload(e.target.files?.[0])}
                disabled={uploading}
                style={{fontSize:12, color:G.muted}}
              />
              <div style={{fontSize:11, color:G.dim, marginTop:6}}>
                {uploading ? '⏳ Upload...' : 'Max 20MB · doar PDF · stocat privat în Supabase Storage'}
              </div>
            </div>
          )}
        </div>

        <div style={{display:'flex', gap:10, marginTop:8}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={() => handleSaveAndAi(false)} disabled={saving || uploading || aiLoading} style={{...S.btnP, flex:1.5, opacity: (saving||uploading||aiLoading) ? 0.6 : 1, background:G.surface, color:G.text, border:`1px solid ${G.border2}`}}>
            {saving ? '⏳ ...' : '✓ Salvează'}
          </button>
          <button 
            onClick={() => handleSaveAndAi(true)} 
            disabled={saving || uploading || aiLoading || !f.pdf_path}
            style={{...S.btnP, flex:1.5, background:G.purple, opacity: (!f.pdf_path||saving||uploading||aiLoading) ? 0.6 : 1}}
            title={!f.pdf_path ? 'Încarcă întâi un PDF' : 'Salvează + extrage clauze cu Claude AI'}
          >
            {aiLoading ? '🤖 AI extrage...' : '🤖 Salvează + Extract AI'}
          </button>
        </div>
        {aiLoading && (
          <div style={{padding:10, background:G.purple+'22', borderRadius:6, fontSize:11, color:G.purple, textAlign:'center'}}>
            ⏳ Claude analizează PDF-ul... (poate dura 10-30 secunde pentru contracte mari)
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function ContractDetailModal({ contract, beneficiari, onClose, onEdit }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const benefMap = Object.fromEntries(beneficiari.map(b => [b.id, b.nume]))
  const si = STATUS_INFO[contract.status] || STATUS_INFO.draft
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
        {/* Header info */}
        <div style={{display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:G.bg, borderRadius:8, flexWrap:'wrap'}}>
          <span style={{padding:'4px 10px', borderRadius:14, background:si.color+'22', color:si.color, fontSize:11, fontWeight:700}}>
            {si.icon} {si.label}
          </span>
          {contract.numar_contract && (
            <span style={{fontSize:12, color:G.muted, fontFamily:'monospace'}}>📄 {contract.numar_contract}</span>
          )}
          <div style={{flex:1}} />
          <button onClick={onEdit} style={{...S.btnS, padding:'6px 12px', fontSize:12}}>✏️ Editează</button>
        </div>

        {/* Detalii grid */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <DetailRow label="🏢 Beneficiar" value={benefMap[contract.beneficiar_id] || '—'} />
          <DetailRow label="💰 Valoare" value={
            contract.valoare_lei ? fmtLei(contract.valoare_lei) :
            contract.valoare_eur ? fmtEur(contract.valoare_eur) : '—'
          } />
          <DetailRow label="📅 Data semnare" value={fmtDate(contract.data_semnare)} />
          <DetailRow label="📅 Data termen" value={fmtDate(contract.data_termen)} />
          <DetailRow label="⏱ Termen execuție" value={contract.termen_executie_zile ? `${contract.termen_executie_zile} zile` : '—'} />
          <DetailRow label="🤖 Extract AI" value={contract.ai_extracted_at ? fmtDate(contract.ai_extracted_at) : 'Neaplicat'} />
        </div>

        {contract.observatii && (
          <div style={{...S.card, background:G.bg}}>
            <div style={S.lbl}>📝 Observații</div>
            <div style={{fontSize:13, color:G.text, lineHeight:1.5}}>{contract.observatii}</div>
          </div>
        )}

        {/* AI extracted */}
        {contract.ai_extracted_at && (
          <div style={{padding:14, background:G.purple+'11', border:`1px solid ${G.purple}44`, borderRadius:10}}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap'}}>
              <span style={{fontSize:18}}>🤖</span>
              <div style={{fontSize:13, fontWeight:700, color:G.purple}}>Clauze extrase de Claude AI</div>
              {clauze.confidence && (
                <span style={{marginLeft:'auto', padding:'2px 8px', background:G.purple+'22', borderRadius:10, fontSize:11, color:G.purple, fontWeight:700}}>
                  Confidence: {clauze.confidence}%
                </span>
              )}
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:10}}>
              {subClauze.penalitati && <ClauzaRow icon="⚠" label="Penalități" value={subClauze.penalitati} />}
              {subClauze.garantii && <ClauzaRow icon="🛡" label="Garanții" value={subClauze.garantii} />}
              {subClauze.plata && <ClauzaRow icon="💰" label="Plată" value={subClauze.plata} />}
              {subClauze.reziliere && <ClauzaRow icon="⛔" label="Reziliere" value={subClauze.reziliere} />}
              {subClauze.observatii && <ClauzaRow icon="📌" label="Alte clauze" value={subClauze.observatii} />}
              {!subClauze.penalitati && !subClauze.garantii && !subClauze.plata && !subClauze.reziliere && !subClauze.observatii && (
                <div style={{fontSize:12, color:G.muted, fontStyle:'italic'}}>Nicio clauză extrasă specific (contractul nu conține sau confidence prea mic)</div>
              )}
            </div>
          </div>
        )}

        {/* PDF link */}
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            display:'inline-flex', alignItems:'center', gap:8, padding:'10px 14px',
            background:G.blue+'22', color:G.blue, textDecoration:'none',
            borderRadius:8, fontSize:13, fontWeight:600,
            border:`1px solid ${G.blue}44`, justifyContent:'center'
          }}>
            📄 Deschide PDF în tab nou
          </a>
        )}

        <button onClick={onClose} style={{...S.btnS, marginTop:8}}>Închide</button>
      </div>
    </ModalShell>
  )
}

function DetailRow({ label, value }) {
  return (
    <div>
      <div style={S.lbl}>{label}</div>
      <div style={{fontSize:13, color:G.text, fontWeight:600}}>{value}</div>
    </div>
  )
}

function ClauzaRow({ icon, label, value }) {
  return (
    <div style={{padding:'8px 12px', background:G.surface, borderRadius:6}}>
      <div style={{fontSize:11, fontWeight:700, color:G.purple, marginBottom:3}}>{icon} {label}</div>
      <div style={{fontSize:12, color:G.text, lineHeight:1.5}}>{value}</div>
    </div>
  )
}

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:9999, padding:20
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14,
        width:'100%', maxWidth: wide ? 720 : 480,
        maxHeight:'90vh', overflow:'auto',
        padding:'22px 26px',
        boxShadow:'0 20px 60px rgba(0,0,0,0.5)'
      }}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18}}>
          <div style={{fontSize:17, fontWeight:800, color:G.text}}>{title}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer', padding:0, lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
