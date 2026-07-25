// ════════════════════════════════════════════════════════════════
// TabDocumenteNAS.jsx — Modul Execuție · Documente NAS
// 02.06.2026
//
// Features:
// - Documente din NAS linkuite la proiectul curent (prin nas_proiecte.executie_proiect_id)
// - Acces filtrat: Executie NU vede propunere_financiara, garantie, seap
// - Categorii cu badge-uri
// - Cauta dupa denumire fișier
// - Copy cale NAS pentru acces direct
// - Modal link folder NAS la proiect (pentru admin)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

import { instrumenteazaStorageRls } from './lib/storageRls.js'

const supabase = instrumenteazaStorageRls(createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
))

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
}

// Categorii permise pentru Executie (matricea de acces)
const CAT_ALLOWED_EXECUTIE = new Set([
  'propunere_tehnica','calitate','situatie_plata','corespondenta',
  'grafic_executie','ncs_nr','altele','subcontractor','asociat',
])

// Afișaj categorii
const CAT_META = {
  propunere_tehnica:    { label:'Propunere tehnică', icon:'📐', color:G.blue },
  calitate:             { label:'Calitate',          icon:'🏆', color:G.green },
  situatie_plata:       { label:'Situație plată',    icon:'💰', color:G.teal },
  corespondenta:        { label:'Corespondență',     icon:'📧', color:G.purple },
  grafic_executie:      { label:'Grafic execuție',   icon:'📅', color:G.orange },
  ncs_nr:               { label:'NCS',               icon:'➕', color:G.yellow },
  altele:               { label:'Altele',             icon:'📄', color:G.muted },
  subcontractor:        { label:'Subcontractor',     icon:'🤝', color:G.blue },
  asociat:              { label:'Asociat',            icon:'🏢', color:G.executie },
  // Blocate pentru Executie (afișate gri în lista admin):
  propunere_financiara: { label:'Propunere fin.',    icon:'🔒', color:G.red },
  garantie:             { label:'Garanție GBE',      icon:'🔒', color:G.red },
  seap:                 { label:'SEAP',               icon:'🔒', color:G.red },
  formulare:            { label:'Formulare',          icon:'🔒', color:G.red },
  furnizori:            { label:'Furnizori',          icon:'📦', color:G.muted },
  erp_date:             { label:'ERP',                icon:'💻', color:G.muted },
}

const EXT_ICON = {
  pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊',
  jpg:'🖼️', jpeg:'🖼️', png:'🖼️', zip:'🗜️', rar:'🗜️',
  '7z':'🗜️', msg:'📧', dwg:'📐', dxf:'📐', mp4:'🎥',
}
const getExtIcon = ext => EXT_ICON[ext?.toLowerCase()] || '📄'

const fmtSize = b => {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024*1024) return `${(b/1024).toFixed(0)} KB`
  return `${(b/1024/1024).toFixed(1)} MB`
}

const NAS_HOST = '\\\\gazpet-tnas'

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

// Modal link folder NAS → proiect
function LinkFolderModal({ proiectId, proiectCod, onClose, onSaved, showToast }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSearch = async () => {
    if (search.trim().length < 2) return
    setSearching(true)
    try {
      const { data } = await supabase
        .from('nas_proiecte')
        .select('id_hash, denumire_folder, beneficiar, nr_licitatie, nas_path')
        .ilike('denumire_folder', `%${search}%`)
        .is('executie_proiect_id', null)
        .limit(10)
      setResults(data || [])
    } finally {
      setSearching(false)
    }
  }

  const handleLink = async (idHash) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('nas_proiecte')
        .update({ executie_proiect_id: proiectId })
        .eq('id_hash', idHash)
      if (error) throw error
      showToast('Folder NAS linkat cu succes!', 'ok')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1010,
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:600, maxHeight:'80vh', overflow:'auto',
      }}>
        <div style={{padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:16, fontWeight:700}}>🔗 Linkează folder NAS</div>
            <div style={{fontSize:12, color:G.muted, marginTop:3}}>Proiect: {proiectCod}</div>
          </div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'20px 24px'}}>
          <div style={{fontSize:13, color:G.muted, marginBottom:16}}>
            Caută folderul din NAS corespunzător acestui contract și linkează-l.
            Documentele vor apărea automat în acest tab.
          </div>
          <div style={{display:'flex', gap:8, marginBottom:16}}>
            <input
              value={search}
              onChange={e=>setSearch(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handleSearch()}
              style={{...S.input, flex:1}}
              placeholder="Caută după denumire folder (ex: 141, Dragasani, Prunisor...)"
            />
            <button onClick={handleSearch} disabled={searching} style={{
              padding:'8px 16px', background:G.blue, border:'none',
              borderRadius:6, color:'#0D1117', fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
            }}>
              {searching ? '...' : '🔍 Caută'}
            </button>
          </div>
          {results.length > 0 && (
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {results.map(r=>(
                <div key={r.id_hash} style={{
                  background:G.card, border:`1px solid ${G.border}`, borderRadius:8,
                  padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                }}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600, fontSize:13, color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.denumire_folder}</div>
                    <div style={{fontSize:11, color:G.muted, marginTop:2}}>{r.beneficiar} {r.nr_licitatie ? `· #${r.nr_licitatie}` : ''}</div>
                  </div>
                  <button onClick={()=>handleLink(r.id_hash)} disabled={saving} style={{
                    padding:'7px 14px', background:G.green, border:'none',
                    borderRadius:6, color:'#fff', fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0,
                  }}>🔗 Linkează</button>
                </div>
              ))}
            </div>
          )}
          {search.length >= 2 && results.length === 0 && !searching && (
            <div style={{textAlign:'center', padding:'20px 0', color:G.muted, fontSize:13}}>
              Niciun folder găsit. Poate nu e indexat încă — scannerul rulează la 12:00 și 22:00.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// proiectId: prop opțional — când vine din ProiectContextView, nu mai afișăm selector
// ══════════════════════════════════════════════════════════
export default function TabDocumenteNAS({ proiectId: proiectIdProp }) {
  const [proiecte, setProiecte]       = useState([])
  const [proiectId, setProiectId]     = useState(proiectIdProp ? String(proiectIdProp) : '')
  const [nasProiecte, setNasProiecte] = useState([]) // folderele NAS linkate
  const [documente, setDocumente]     = useState([])
  const [profile, setProfile]         = useState(null)
  const [loading, setLoading]         = useState(false)
  const [search, setSearch]           = useState('')
  const [filterCat, setFilterCat]     = useState('all')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const { show: showToast, Toast }    = useToast()

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

  const loadDocumente = useCallback(async () => {
    if (!proiectId) return
    setLoading(true)
    try {
      // Folderele NAS linkate la proiect
      const { data: nasProj } = await supabase
        .from('nas_proiecte')
        .select('id_hash, denumire_folder, nas_path, beneficiar')
        .eq('executie_proiect_id', proiectId)

      setNasProiecte(nasProj || [])

      if (!nasProj?.length) {
        setDocumente([])
        setLoading(false)
        return
      }

      const hashes = nasProj.map(p=>p.id_hash)

      // Documente din folderele linkate
      const { data, error } = await supabase
        .from('nas_documente')
        .select('id_hash, nas_path, denumire, extensie, categorie, subfolder, size_bytes, data_modificare, proiect_id_hash')
        .in('proiect_id_hash', hashes)
        .order('categorie').order('denumire')

      if (error) throw error
      setDocumente(data || [])
    } catch(e) {
      showToast('Eroare: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadDocumente() }, [loadDocumente])

  const isOwner  = profile?.is_owner === true
  const isMgmt   = isOwner || profile?.can_access_salarii
  // Executie vede doar categoriile permise, management vede tot
  const docsVizibile = useMemo(() => {
    return documente.filter(d => isMgmt || CAT_ALLOWED_EXECUTIE.has(d.categorie))
  }, [documente, isMgmt])

  const filtered = useMemo(() => {
    return docsVizibile.filter(d => {
      if (filterCat !== 'all' && d.categorie !== filterCat) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return d.denumire.toLowerCase().includes(q) || d.nas_path.toLowerCase().includes(q)
      }
      return true
    })
  }, [docsVizibile, filterCat, search])

  const catCounts = useMemo(() => {
    const counts = {}
    docsVizibile.forEach(d => { counts[d.categorie] = (counts[d.categorie]||0)+1 })
    return counts
  }, [docsVizibile])

  const categoriiDisponibile = Object.keys(catCounts).sort()

  const copyPath = (nasPath) => {
    const fullPath = `${NAS_HOST}\\Licitatii_Executate\\${nasPath.replace(/\//g,'\\')}`
    navigator.clipboard.writeText(fullPath).then(()=>showToast('Cale copiată! ✂️', 'ok'))
  }

  const proiectCurent = proiecte.find(p=>String(p.id)===proiectId)
  const docsBlocked   = documente.length - docsVizibile.length

  return (
    <div style={{padding:'24px 28px', maxWidth:1400, margin:'0 auto'}}>
      <Toast />

      {/* ─── HEADER ─── */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16, flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0, fontSize:22, fontWeight:800}}>📂 Documente NAS</h2>
          <div style={{color:G.muted, fontSize:13, marginTop:4}}>
            Arhivă proiect · Propunere tehnică · Situații plată · Corespondență
          </div>
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
        </div>
      </div>

      {/* ─── STATUS LINKARE NAS ─── */}
      {!loading && nasProiecte.length === 0 ? (
        <div style={{
          background:G.surface, border:`2px dashed ${G.border}`, borderRadius:12,
          padding:'40px 32px', textAlign:'center', marginBottom:20,
        }}>
          <div style={{fontSize:48, marginBottom:12, opacity:.5}}>🔗</div>
          <div style={{fontSize:16, fontWeight:700, marginBottom:8}}>Niciun folder NAS linkat</div>
          <div style={{color:G.muted, fontSize:13, marginBottom:20, maxWidth:480, margin:'0 auto 20px'}}>
            Proiectul <strong style={{color:G.text}}>{proiectCurent?.cod_intern}</strong> nu are un folder NAS asociat.
            {isOwner ? ' Linkează folderul pentru a vedea documentele arhivate.' : ' Contactează administratorul pentru linkare.'}
          </div>
          {isOwner && (
            <button onClick={()=>setShowLinkModal(true)} style={{
              padding:'11px 24px', background:G.blue, border:'none',
              borderRadius:8, color:'#0D1117', fontWeight:700, fontSize:14, cursor:'pointer',
            }}>🔗 Linkează folder NAS</button>
          )}
        </div>
      ) : nasProiecte.length > 0 && (
        <div style={{
          background:G.green+'11', border:`1px solid ${G.green}33`, borderRadius:10,
          padding:'12px 16px', marginBottom:20,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        }}>
          <div style={{display:'flex', alignItems:'center', gap:12}}>
            <span style={{fontSize:20}}>✅</span>
            <div>
              <div style={{fontWeight:600, fontSize:13}}>
                {nasProiecte.length} folder{nasProiecte.length>1?'e':''} NAS linkat{nasProiecte.length>1?'e':''}
              </div>
              <div style={{fontSize:12, color:G.muted}}>
                {nasProiecte.map(p=>p.denumire_folder.slice(0,60)).join(' · ')}
              </div>
            </div>
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            {docsBlocked > 0 && !isMgmt && (
              <span style={{
                padding:'4px 10px', background:G.red+'22', borderRadius:8,
                fontSize:12, color:G.red, fontWeight:600,
              }}>🔒 {docsBlocked} doc. restricționate (acces management)</span>
            )}
            {isOwner && (
              <button onClick={()=>setShowLinkModal(true)} style={{
                padding:'6px 12px', background:G.border2, border:`1px solid ${G.border}`,
                borderRadius:6, color:G.muted, cursor:'pointer', fontSize:12,
              }}>＋ Alt folder</button>
            )}
          </div>
        </div>
      )}

      {/* ─── KPI CATEGORII ─── */}
      {docsVizibile.length > 0 && (
        <div style={{display:'flex', gap:8, marginBottom:20, flexWrap:'wrap'}}>
          <button
            onClick={()=>setFilterCat('all')}
            style={{
              padding:'6px 14px', borderRadius:20, border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
              background:filterCat==='all'?G.executie+'33':G.border2,
              color:filterCat==='all'?G.executie:G.muted,
              outline:filterCat==='all'?`1.5px solid ${G.executie}`:'none',
            }}
          >
            Toate ({docsVizibile.length})
          </button>
          {categoriiDisponibile.map(cat=>{
            const m = CAT_META[cat] || {label:cat, icon:'📄', color:G.muted}
            const cnt = catCounts[cat]
            const isActive = filterCat === cat
            return (
              <button key={cat} onClick={()=>setFilterCat(cat)}
                style={{
                  padding:'6px 14px', borderRadius:20, border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                  background:isActive?m.color+'33':G.border2,
                  color:isActive?m.color:G.muted,
                  outline:isActive?`1.5px solid ${m.color}`:'none',
                  display:'flex', alignItems:'center', gap:5,
                }}
              >
                <span>{m.icon}</span>{m.label}
                <span style={{
                  background:isActive?m.color:G.border, color:isActive?'#0D1117':G.text,
                  borderRadius:10, padding:'1px 7px', fontSize:10,
                }}>{cnt}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ─── SEARCH ─── */}
      {docsVizibile.length > 0 && (
        <div style={{marginBottom:16}}>
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{...S.input, maxWidth:400}}
            placeholder="🔍 Caută după denumire fișier..."
          />
        </div>
      )}

      {/* ─── LISTA DOCUMENTE ─── */}
      {loading ? (
        <div style={{textAlign:'center', padding:'60px 0', color:G.muted}}>⏳ Se încarcă...</div>
      ) : filtered.length === 0 && docsVizibile.length > 0 ? (
        <div style={{textAlign:'center', padding:'40px 0', color:G.muted}}>
          Niciun document pentru filtrele selectate.
        </div>
      ) : docsVizibile.length > 0 ? (
        <div style={{overflowX:'auto'}}>
          <div style={{
            fontSize:12, color:G.muted, marginBottom:8,
            display:'flex', justifyContent:'space-between',
          }}>
            <span>{filtered.length} documente</span>
            <span style={{color:G.dim}}>Click pe 📋 pentru a copia calea NAS</span>
          </div>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
            <thead>
              <tr style={{background:G.surface, borderBottom:`1px solid ${G.border}`}}>
                {['','Denumire','Categorie','Subfolder','Dimensiune','Data','Cale NAS'].map((h,i)=>(
                  <th key={i} style={{
                    padding:'9px 10px', textAlign:'left', fontWeight:600,
                    color:G.muted, fontSize:11, textTransform:'uppercase', letterSpacing:'.3px', whiteSpace:'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d,idx)=>{
                const m   = CAT_META[d.categorie] || {label:d.categorie, icon:'📄', color:G.muted}
                const ext = d.extensie?.toLowerCase()
                return (
                  <tr key={d.id_hash} style={{
                    borderBottom:`1px solid ${G.border2}`,
                    background:idx%2===0?'transparent':G.bg+'88',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=G.surface}
                    onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'transparent':G.bg+'88'}
                  >
                    <td style={{padding:'8px 10px', fontSize:18, lineHeight:1}}>{getExtIcon(ext)}</td>
                    <td style={{padding:'8px 10px'}}>
                      <div style={{
                        fontWeight:500, color:G.text, maxWidth:300,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      }} title={d.denumire}>{d.denumire}</div>
                      {ext && <span style={{fontSize:10, color:G.dim, textTransform:'uppercase'}}>.{ext}</span>}
                    </td>
                    <td style={{padding:'8px 10px'}}>
                      <span style={{
                        padding:'3px 8px', borderRadius:10, fontSize:11, fontWeight:600,
                        background:m.color+'22', color:m.color, whiteSpace:'nowrap',
                      }}>{m.icon} {m.label}</span>
                    </td>
                    <td style={{padding:'8px 10px', color:G.dim, fontSize:11, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={d.subfolder}>
                      {d.subfolder || '—'}
                    </td>
                    <td style={{padding:'8px 10px', color:G.dim, fontSize:11, whiteSpace:'nowrap'}}>
                      {fmtSize(d.size_bytes)}
                    </td>
                    <td style={{padding:'8px 10px', color:G.muted, fontSize:11, whiteSpace:'nowrap'}}>
                      {d.data_modificare}
                    </td>
                    <td style={{padding:'8px 10px'}}>
                      <button
                        onClick={()=>copyPath(d.nas_path)}
                        title={`Copiază calea: \\\\gazpet-tnas\\...\\${d.denumire}`}
                        style={{
                          padding:'4px 10px', background:G.border2, border:'none',
                          borderRadius:5, color:G.muted, cursor:'pointer', fontSize:11,
                          display:'flex', alignItems:'center', gap:4,
                        }}
                      >
                        📋 Cale
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ─── MODAL LINK FOLDER ─── */}
      {showLinkModal && (
        <LinkFolderModal
          proiectId={parseInt(proiectId)}
          proiectCod={proiectCurent?.cod_intern}
          onClose={()=>setShowLinkModal(false)}
          onSaved={()=>{ setShowLinkModal(false); loadDocumente() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}
