// ===========================================================================
// MODUL IZOMETRIE — Pachete lansare țeavă · Tronsoane · Cumulat final
// ===========================================================================
// 21.05.2026 — FAZA 2:
//   • Editor inline țevi cu URL param ?pachet=ID (toggle list ↔ editor)
//   • Cell editing: click direct pe celulă, Tab/Enter/Esc/Ctrl+V paste
//   • POZ KM auto-cascade client-side (preview optimist) + refetch după save
//   • Validări live debounced 400ms (serie cross-proiect, sudură cross-tronson)
//   • Salvare hibridă: optimistic per blur + buton manual „Salvează tot"
//   • 4 butoane add rând: țeavă/curbă/legare/separator
//   • Sufix R automat → sudura_refacuta=true + badge
//   • Delete per rând + bulk delete prin checkbox
// 20.05.2026 — FAZA 1:
//   • Listare proiecte execuție (selectabile via dropdown header)
//   • Sidebar cu 11 tronsoane T1-T11 + KPI mini (pachete + lungime)
//   • Main: listă pachete pe tronson + creare pachet nou manual
//   • Placeholder pentru bulk import Excel (Faza B viitor)
// Stack: 8 tabele BD în public.executie_* + RLS permissive + 13 triggere
// ===========================================================================

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import ImportExcelModal from './ImportExcelIzometrie.jsx'
import { generateCentralizatorXlsx, buildCentralizatorFilename } from './exportCentralizatorXlsx.js'

// Theme — paletă G consistentă cu Logistica/HR/Admin
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7', // accent modul Izometrie
  purpleDim:'#1F1530', greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100',
}

const S = {
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.purple, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500 },
  badge: { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}

// ===========================================================================
// HELPERS
// ===========================================================================

const fmtKm = (m) => {
  if (m == null) return '—'
  const km = Math.floor(m / 1000)
  const rest = Math.round(m % 1000)
  return `${km}+${String(rest).padStart(3,'0')}`
}

const fmtLungime = (m) => m == null ? '—' : `${Number(m).toFixed(2)} m`

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

// Extrage unghi din DIMENSIUNE (ex: "610.0X8.00 30°" → "30°")
// Suportă atât ° (U+00B0 degree sign) cât și ˚ (U+02DA ring above — folosit în Excel Transgaz)
const extractUnghi = (dim) => {
  if (!dim) return null
  const m = String(dim).match(/(\d+)\s*[°˚]/)
  return m ? `${m[1]}°` : null
}

// Parse SUDURĂ cu sufix R → returnează { cod, refacuta }
const parseSudura = (raw) => {
  if (!raw) return { cod: null, refacuta: false }
  const s = String(raw).trim()
  if (s.endsWith('R')) return { cod: s.slice(0, -1).trim(), refacuta: true }
  return { cod: s, refacuta: false }
}

// Toast minimal (consistent cu Logistica/HR)
function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, kind='info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3500)
  }
  return { toast, show }
}

function Toast({ toast }) {
  if (!toast) return null
  const colors = { info: G.blue, success: G.green, error: G.red, warn: G.yellow }
  const c = colors[toast.kind] || G.blue
  return (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background:G.card, border:`1px solid ${c}`, borderRadius:10,
      color:G.text, fontSize:13, fontWeight:500, zIndex:9999,
      boxShadow:`0 8px 24px ${c}33`, maxWidth: 420,
    }}>
      {toast.msg}
    </div>
  )
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

export default function IzometriePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const pachetIdFromUrl = searchParams.get('pachet')
  const pachetEditorId = pachetIdFromUrl ? Number(pachetIdFromUrl) : null

  const [proiecte, setProiecte] = useState([])
  const [proiectId, setProiectId] = useState(null)
  const [tronsoane, setTronsoane] = useState([])
  const [tronsonId, setTronsonId] = useState(null)
  const [pachete, setPachete] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNoPachet, setShowNoPachet] = useState(false)
  const { toast, show } = useToast()

  // Stats per tronson
  const [statsTronsoane, setStatsTronsoane] = useState({})

  useEffect(() => { loadProiecte() }, [])
  useEffect(() => { if (proiectId) loadTronsoane() }, [proiectId])
  useEffect(() => { if (tronsonId) loadPachete() }, [tronsonId])
  useEffect(() => { if (proiectId) loadStatsTronsoane() }, [proiectId, pachete.length])

  async function loadProiecte() {
    setLoading(true)
    const { data, error } = await supabase
      .from('executie_proiecte').select('*')
      .eq('activ', true).order('created_at')
    if (error) { show('Eroare load proiecte: ' + error.message, 'error'); setLoading(false); return }
    setProiecte(data || [])
    if (data?.length && !proiectId) setProiectId(data[0].id)
    setLoading(false)
  }

  async function loadTronsoane() {
    const { data, error } = await supabase
      .from('executie_tronsoane').select('*')
      .eq('proiect_id', proiectId).order('cod')
    if (error) { show('Eroare load tronsoane: ' + error.message, 'error'); return }
    setTronsoane(data || [])
    if (data?.length && !tronsonId) setTronsonId(data[0].id)
  }

  async function loadPachete() {
    const { data, error } = await supabase
      .from('executie_pachete_lansare').select('*')
      .eq('tronson_id', tronsonId)
      .order('numar_document', { ascending: false })
    if (error) { show('Eroare load pachete: ' + error.message, 'error'); return }
    setPachete(data || [])
  }

  async function loadStatsTronsoane() {
    if (!proiectId) return
    const { data, error } = await supabase
      .from('executie_pachete_lansare')
      .select('tronson_id, total_lungime_m')
      .eq('proiect_id', proiectId)
    if (error) return
    const stats = {}
    for (const p of (data || [])) {
      if (!stats[p.tronson_id]) stats[p.tronson_id] = { nr_pachete: 0, total_m: 0 }
      stats[p.tronson_id].nr_pachete += 1
      stats[p.tronson_id].total_m += Number(p.total_lungime_m || 0)
    }
    setStatsTronsoane(stats)
  }

  // Deschide editor pachet via URL
  const openPachet = useCallback((pachetId) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('pachet', String(pachetId))
      return next
    }, { replace: false })
  }, [setSearchParams])

  const closePachet = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('pachet')
      return next
    }, { replace: false })
  }, [setSearchParams])

  const proiectSelectat = useMemo(() => proiecte.find(p => p.id === proiectId), [proiecte, proiectId])
  const tronsonSelectat = useMemo(() => tronsoane.find(t => t.id === tronsonId), [tronsoane, tronsonId])

  if (loading) {
    return (
      <div style={S.page}>
        <div style={{ color: G.muted, fontSize: 14 }}>Se încarcă...</div>
      </div>
    )
  }

  if (!proiecte.length) {
    return (
      <div style={S.page}>
        <div style={{...S.card, padding:'40px', textAlign:'center'}}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📐</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Niciun proiect de execuție</div>
          <div style={{ color: G.muted, fontSize: 14 }}>
            Creează primul proiect din BD (Supabase Dashboard) și revino aici.
          </div>
        </div>
      </div>
    )
  }

  // === VIEW: Editor pachet (URL ?pachet=ID) ===
  if (pachetEditorId) {
    return (
      <div style={S.page}>
        <Toast toast={toast} />
        <PachetEditor
          pachetId={pachetEditorId}
          tronsoane={tronsoane}
          proiectId={proiectId}
          onClose={closePachet}
          onError={(msg) => show(msg, 'error')}
          onSuccess={(msg) => show(msg, 'success')}
          onWarn={(msg) => show(msg, 'warn')}
          onPachetChanged={() => loadPachete()}
        />
      </div>
    )
  }

  // === VIEW: Listare pachete (default) ===
  return (
    <div style={S.page}>
      <Toast toast={toast} />

      {/* ─────────── HEADER ─────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 20, flexWrap:'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-.3px', marginBottom: 4 }}>
            📐 Izometrie · Pachete Lansare Țeavă
          </div>
          <div style={{ color: G.muted, fontSize: 13 }}>
            {proiectSelectat?.nume || 'Selectează proiect'}
          </div>
        </div>
        <select
          value={proiectId || ''}
          onChange={e => { setProiectId(Number(e.target.value)); setTronsonId(null) }}
          style={{ ...S.input, width: 280, fontWeight: 600, cursor:'pointer' }}
        >
          {proiecte.map(p => (
            <option key={p.id} value={p.id}>{p.cod_intern} — {p.beneficiar}</option>
          ))}
        </select>
      </div>

      {/* ─────────── LAYOUT 2 COLOANE ─────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap: 16, alignItems:'start' }}>
        
        {/* SIDEBAR TRONSOANE */}
        <div style={{...S.card, padding: 14}}>
          <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom: 12 }}>
            Tronsoane ({tronsoane.length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
            {tronsoane.map(t => {
              const stats = statsTronsoane[t.id] || { nr_pachete: 0, total_m: 0 }
              const isActive = tronsonId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTronsonId(t.id)}
                  style={{
                    background: isActive ? G.purpleDim : G.surface,
                    border: `1px solid ${isActive ? G.purple : G.border2}`,
                    borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                    textAlign:'left', color: G.text, transition:'all .15s ease',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = G.border }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = G.border2 }}
                >
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? G.purple : G.text }}>
                      {t.cod}
                    </span>
                    <span style={{
                      ...S.badge,
                      background: stats.nr_pachete > 0 ? G.purple+'22' : G.border2,
                      color: stats.nr_pachete > 0 ? G.purple : G.muted,
                    }}>
                      {stats.nr_pachete} pachete
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>
                    {t.km_start_m != null && t.km_end_m != null ? (
                      <>{fmtKm(t.km_start_m)} → {fmtKm(t.km_end_m)}</>
                    ) : t.km_start_m != null ? (
                      <>de la {fmtKm(t.km_start_m)}</>
                    ) : (
                      <span style={{ fontStyle:'italic' }}>km TBD</span>
                    )}
                    {stats.total_m > 0 && <> · {stats.total_m.toFixed(0)}m lansați</>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* MAIN — PACHETE */}
        <div style={{ display:'flex', flexDirection:'column', gap: 12 }}>
          {tronsonSelectat && (
            <>
              {/* Header tronson + acțiuni */}
              <div style={{...S.card, padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 12}}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                    Tronson <span style={{ color: G.purple }}>{tronsonSelectat.cod}</span>
                  </div>
                  <div style={{ fontSize: 12, color: G.muted }}>
                    {pachete.length} pachete lansare ·{' '}
                    {pachete.reduce((s,p) => s + Number(p.total_lungime_m || 0), 0).toFixed(2)} m total lansat ·{' '}
                    {pachete.reduce((s,p) => s + (p.nr_pending_sant || 0), 0)} suduri pending șanț
                  </div>
                  {tronsonSelectat.observatii && (
                    <div style={{ fontSize: 11, color: G.muted, marginTop: 6, fontStyle:'italic' }}>
                      ℹ {tronsonSelectat.observatii}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', gap: 8 }}>
                  <button style={S.btnP} onClick={() => setShowNoPachet(true)}>+ Pachet nou</button>
                  <button
                    style={{ ...S.btnS, opacity: 0.5, cursor:'not-allowed' }}
                    title="Disponibil în Faza B"
                    disabled
                  >
                    📥 Import Excel
                  </button>
                </div>
              </div>

              {/* Listă pachete */}
              {pachete.length === 0 ? (
                <div style={{...S.card, padding:'40px', textAlign:'center'}}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                    Niciun pachet pe tronson {tronsonSelectat.cod}
                  </div>
                  <div style={{ color: G.muted, fontSize: 13, marginBottom: 16 }}>
                    Creează primul pachet manual sau importă dintr-un Excel.
                  </div>
                  <button style={S.btnP} onClick={() => setShowNoPachet(true)}>
                    + Pachet nou pe {tronsonSelectat.cod}
                  </button>
                </div>
              ) : (
                <div style={{...S.card, overflow:'hidden'}}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: G.surface, borderBottom: `1px solid ${G.border}` }}>
                        <th style={thStyle}>Cod document</th>
                        <th style={thStyle}>Rev.</th>
                        <th style={thStyle}>km start</th>
                        <th style={thStyle}>Lansare</th>
                        <th style={{...thStyle, textAlign:'right'}}>Țevi</th>
                        <th style={{...thStyle, textAlign:'right'}}>Lungime</th>
                        <th style={{...thStyle, textAlign:'right'}}>Pending șanț</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pachete.map(p => (
                        <tr
                          key={p.id}
                          onClick={() => openPachet(p.id)}
                          style={{ borderBottom: `1px solid ${G.border2}`, cursor:'pointer', transition:'background .15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = G.surface}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={tdStyle}>
                            <span style={{ fontFamily:'monospace', fontSize: 12, color: G.purple, fontWeight: 600 }}>
                              {p.cod_document_full}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            {p.revizie > 0 ? (
                              <span style={{...S.badge, background: G.yellow+'22', color: G.yellow}}>rev.{p.revizie}</span>
                            ) : (
                              <span style={{ color: G.muted, fontSize: 11 }}>—</span>
                            )}
                          </td>
                          <td style={tdStyle}>{fmtKm(p.km_start_m)}</td>
                          <td style={tdStyle}>{fmtDate(p.data_lansare)}</td>
                          <td style={{...tdStyle, textAlign:'right', fontWeight: 600}}>{p.nr_tevi}</td>
                          <td style={{...tdStyle, textAlign:'right'}}>{fmtLungime(p.total_lungime_m)}</td>
                          <td style={{...tdStyle, textAlign:'right'}}>
                            {p.nr_pending_sant > 0 ? (
                              <span style={{...S.badge, background: G.orange+'22', color: G.orange}}>
                                {p.nr_pending_sant}
                              </span>
                            ) : (
                              <span style={{ color: G.muted, fontSize: 11 }}>0</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {p.respins_la ? (
                              <span style={{...S.badge, background: G.red+'22', color: G.red}}>Respins</span>
                            ) : p.status === 'aprobat' ? (
                              <span
                                style={{...S.badge, background: G.green+'22', color: G.green, fontWeight: 600}}
                                title={p.aprobat_la ? `Aprobat la ${fmtDate(p.aprobat_la.slice(0,10))}` : 'Aprobat de Transgaz'}
                              >
                                ✅ Aprobat
                              </span>
                            ) : p.status === 'lansat' ? (
                              <span style={{...S.badge, background: G.purple+'22', color: G.purple, fontWeight: 600}}>
                                🚀 Lansat
                              </span>
                            ) : p.status === 'finalizat' ? (
                              <span style={{...S.badge, background: G.blue+'22', color: G.blue, fontWeight: 600}}>
                                🏁 Finalizat
                              </span>
                            ) : p.status === 'trimis_aprobare' ? (
                              <span style={{...S.badge, background: G.yellow+'22', color: G.yellow}}>
                                ⏳ La aprobare
                              </span>
                            ) : (
                              <span style={{...S.badge, background: G.muted+'22', color: G.muted}}>Draft</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!tronsonSelectat && (
            <div style={{...S.card, padding:'40px', textAlign:'center'}}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👈</div>
              <div style={{ color: G.muted, fontSize: 14 }}>Selectează un tronson din stânga</div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: Pachet nou */}
      {showNoPachet && tronsonSelectat && (
        <NoPachetModal
          tronson={tronsonSelectat}
          proiectId={proiectId}
          onClose={() => setShowNoPachet(false)}
          onSuccess={(pachet) => {
            setShowNoPachet(false)
            show(`Pachet ${pachet.cod_document_full} creat ✓`, 'success')
            loadPachete()
            // Deschide automat editor pe pachetul nou creat
            openPachet(pachet.id)
          }}
          onError={(msg) => show(msg, 'error')}
        />
      )}
    </div>
  )
}

// ===========================================================================
// STILURI TABEL
// ===========================================================================

const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  color: G.muted,
}

const tdStyle = {
  padding: '11px 14px',
  fontSize: 13,
  color: G.text,
}

// ===========================================================================
// PACHET EDITOR — Faza 2 NOU
// ===========================================================================
// Editor inline pentru țevi dintr-un pachet de lansare.
// - URL: /executie?tab=izometrie&pachet=ID
// - Click pe celulă → edit; Tab/Enter/Esc navigation; Ctrl+V paste din Excel
// - Validări live debounced 400ms (serie cross-proiect, sudură cross-tronson)
// - Salvare hibridă: optimistic per blur + buton manual „Salvează tot"

// Definire coloane editor — config-driven render
const COL_DEFS = [
  { key:'_select',     label:'',       width:36,  align:'center', edit:false, sticky:true },
  { key:'poz_in_pachet', label:'#',     width:42,  align:'right',  edit:false },
  { key:'tip_rand',    label:'Tip',    width:110, edit:false }, // badge readonly
  { key:'lot',         label:'Lot',    width:50,  edit:'text' },
  { key:'serie_unica', label:'Serie unică', width:110, edit:'text', validate:'serie', mono:true },
  { key:'tip',         label:'Tip mat.',  width:62,  edit:'text' },
  { key:'dimensiune',  label:'Dimensiune',width:140, edit:'text' },
  { key:'sarja',       label:'Șarja', width:90,  edit:'text', mono:true },
  { key:'lungime_m',   label:'Cant (m)', width:60,  align:'right', edit:'number' },
  { key:'_poz_km',     label:'POZ KM', width:78,  align:'right', edit:false, mono:true },
  { key:'sudura_cod',  label:'Sudură',width:88,  edit:'text', validate:'sudura', mono:true },
  { key:'pm_cod',      label:'PM',    width:80,  edit:'text', mono:true },
  { key:'pa_ut_cod',   label:'PA-UT', width:92,  edit:'text', mono:true },
  { key:'ut_cod',      label:'UT',    width:54,  edit:'text', mono:true },
  { key:'observatii',  label:'Obs',   width:104, edit:'text' },
  { key:'_actions',    label:'',      width:170, align:'center', edit:false },
]

// Câmpurile editabile pe tip_rand (separator = nimic, legare = doar sudura+PM)
const EDITABLE_FIELDS = {
  teava:    new Set(['lot','serie_unica','tip','dimensiune','sarja','lungime_m','sudura_cod','pm_cod','pa_ut_cod','ut_cod','observatii']),
  curba:    new Set(['lot','serie_unica','tip','dimensiune','sarja','lungime_m','sudura_cod','pm_cod','pa_ut_cod','ut_cod','observatii']),
  legare:   new Set(['sudura_cod','pm_cod','pa_ut_cod','ut_cod','observatii']),
  separator:new Set(['observatii']),
}

// Culori badge pe tip
const TIP_RAND_COLORS = {
  teava: G.blue, curba: G.orange, legare: G.green, separator: G.muted,
}

// Câmpuri care pot avea cap-la-cap navigation (pentru Tab/Enter)
const NAV_FIELDS = ['lot','serie_unica','tip','dimensiune','sarja','lungime_m','sudura_cod','pm_cod','pa_ut_cod','ut_cod','observatii']

function PachetEditor({ pachetId, tronsoane, proiectId, onClose, onError, onSuccess, onWarn, onPachetChanged }) {
  const [pachet, setPachet] = useState(null)
  const [tevi, setTevi] = useState([])
  const [tronson, setTronson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState(null) // { rowId, field }
  const [draft, setDraft] = useState('') // value în input curent
  const [dirty, setDirty] = useState(new Set()) // ids rânduri cu modificări nesalvate (după eroare optimistic)
  const [validation, setValidation] = useState({}) // { 'rowId:field': { ok: bool, msg: str } }
  const [selected, setSelected] = useState(new Set()) // ids rânduri bifate
  const [saving, setSaving] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportHistory, setExportHistory] = useState([]) // documente generate anterior
  // Sub-faza Y: Upload PDF aprobat Transgaz
  const [showAprobat, setShowAprobat] = useState(false)
  const [uploadingAprobat, setUploadingAprobat] = useState(false)
  const [aprobariHistory, setAprobariHistory] = useState([])

  const validationAborters = useRef({})

  useEffect(() => { loadAll() }, [pachetId]) // eslint-disable-line

  async function loadAll() {
    setLoading(true)
    // Pachet + țevi în paralel
    const [pRes, tRes] = await Promise.all([
      supabase.from('executie_pachete_lansare').select('*').eq('id', pachetId).single(),
      supabase.from('executie_tevi').select('*').eq('pachet_id', pachetId).order('poz_in_pachet'),
    ])
    if (pRes.error) { onError('Eroare load pachet: ' + pRes.error.message); setLoading(false); return }
    if (tRes.error) { onError('Eroare load țevi: ' + tRes.error.message); setLoading(false); return }
    setPachet(pRes.data)
    setTevi(tRes.data || [])
    const tron = tronsoane.find(t => t.id === pRes.data.tronson_id)
    setTronson(tron)
    setLoading(false)
    setDirty(new Set())
  }

  // ───────── POZ KM cascade preview (client-side) ─────────
  // BD trigger recalculează exact la INSERT/UPDATE (TODO trigger fn_executie_tevi_calc_poz_km).
  // FORMULA: pachet.km_start_m = POZ KM al rândului 1 (= prima sudură pe pachet).
  // POZ KM al elementului i:
  //   - i=0 (primul): km_start (= prima sudură, fie legare fie capăt prima țeavă)
  //   - i>0 + teava/curba cu lungime: cumulat += lungime ÎNAINTE de atribuire (= poziția sudurii la capătul țevii)
  //   - legare: nu adaugă lungime, dar are POZ KM = poziția sudurii (= cumulat curent)
  //   - separator: POZ KM = NULL (fără semnificație fizică)
  const teviWithPozKm = useMemo(() => {
    if (!pachet) return tevi
    let cumulat = pachet.km_start_m || 0
    return tevi.map((t, i) => {
      // Pentru i>0, adunăm lungimea elementului CURENT ÎNAINTE de atribuire
      // (POZ KM = poziția sudurii la capătul țevii curente)
      if (i > 0 && (t.tip_rand === 'teava' || t.tip_rand === 'curba') && t.lungime_m) {
        cumulat += Number(t.lungime_m)
      }
      // Separator → NULL, restul → cumulat curent
      return { ...t, _poz_km: t.tip_rand === 'separator' ? null : cumulat }
    })
  }, [tevi, pachet])

  // ───────── Refetch pachet (după save țeavă, trigger recalculează totaluri) ─────────
  async function refetchPachet() {
    const { data } = await supabase.from('executie_pachete_lansare').select('*').eq('id', pachetId).single()
    if (data) { setPachet(data); onPachetChanged && onPachetChanged() }
  }

  // ───────── Refetch toate țevile (după save, pentru poz_km_m corect din BD) ─────────
  async function refetchTevi() {
    const { data } = await supabase.from('executie_tevi').select('*').eq('pachet_id', pachetId).order('poz_in_pachet')
    if (data) setTevi(data)
  }

  // ───────── Validare debounced ─────────
  const debouncedValidate = useCallback((rowId, field, value) => {
    const key = `${rowId}:${field}`
    // Cancel previous
    if (validationAborters.current[key]) validationAborters.current[key].abort()
    if (!value || !String(value).trim()) {
      setValidation(v => { const n = {...v}; delete n[key]; return n })
      return
    }
    const ctrl = new AbortController()
    validationAborters.current[key] = ctrl

    const timeoutId = setTimeout(async () => {
      if (ctrl.signal.aborted) return
      try {
        if (field === 'serie_unica') {
          // serie unică cross-PROIECT: JOIN tevi → pachet → tronson → proiect
          const { data, error } = await supabase
            .from('executie_tevi')
            .select('id, pachet_id, pachet:executie_pachete_lansare!inner(cod_document_full, proiect_id)')
            .eq('serie_unica', String(value).trim())
            .eq('pachet.proiect_id', proiectId)
            .neq('id', rowId)
            .limit(1)
          if (ctrl.signal.aborted) return
          if (error) return
          if (data && data.length) {
            const dup = data[0]
            setValidation(v => ({ ...v, [key]: { ok:false, msg:`Serie duplicată în ${dup.pachet.cod_document_full}` } }))
          } else {
            setValidation(v => ({ ...v, [key]: { ok:true, msg:null } }))
          }
        } else if (field === 'sudura_cod') {
          // sudură unică cross-TRONSON: JOIN tevi → pachet → tronson
          const { cod } = parseSudura(value)
          if (!cod) {
            setValidation(v => { const n = {...v}; delete n[key]; return n })
            return
          }
          const { data, error } = await supabase
            .from('executie_tevi')
            .select('id, pachet:executie_pachete_lansare!inner(cod_document_full, tronson_id)')
            .eq('sudura_cod', cod)
            .eq('pachet.tronson_id', pachet.tronson_id)
            .neq('id', rowId)
            .limit(1)
          if (ctrl.signal.aborted) return
          if (error) return
          if (data && data.length) {
            const dup = data[0]
            setValidation(v => ({ ...v, [key]: { ok:false, msg:`Sudură duplicată în ${dup.pachet.cod_document_full}` } }))
          } else {
            setValidation(v => ({ ...v, [key]: { ok:true, msg:null } }))
          }
        }
      } catch (e) {
        // silent
      }
    }, 400)
    // Atașăm cleanup
    ctrl.signal.addEventListener('abort', () => clearTimeout(timeoutId))
  }, [proiectId, pachet?.tronson_id])

  // ───────── Add row ─────────
  async function addRow(tip_rand) {
    const newPoz = tevi.length + 1
    const payload = {
      pachet_id: pachetId,
      poz_in_pachet: newPoz,
      tip_rand,
      tip: tip_rand === 'curba' ? 'CIC' : tip_rand === 'teava' ? 'L360' : null,
    }
    const { data, error } = await supabase
      .from('executie_tevi').insert(payload).select().single()
    if (error) { onError('Eroare adăugare rând: ' + error.message); return }
    setTevi(prev => [...prev, data])
    await refetchPachet()
    onSuccess(`Rând ${tip_rand} adăugat`)
  }

  // ───────── Delete row(s) ─────────
  async function deleteRow(rowId) {
    if (!window.confirm('Ștergi acest rând? Acțiunea NU poate fi anulată.')) return
    const { error } = await supabase.from('executie_tevi').delete().eq('id', rowId)
    if (error) { onError('Eroare ștergere: ' + error.message); return }
    setTevi(prev => prev.filter(r => r.id !== rowId))
    setSelected(prev => { const n = new Set(prev); n.delete(rowId); return n })
    await refetchPachet()
    // Renumerotare automată via trigger BD — refetch pentru poz_in_pachet corect
    await refetchTevi()
    onSuccess('Rând șters')
  }

  async function deleteBulk() {
    if (!selected.size) return
    if (!window.confirm(`Ștergi ${selected.size} rânduri? Acțiunea NU poate fi anulată.`)) return
    const { error } = await supabase.from('executie_tevi').delete().in('id', Array.from(selected))
    if (error) { onError('Eroare ștergere bulk: ' + error.message); return }
    setSelected(new Set())
    await refetchPachet()
    await refetchTevi()
    onSuccess(`${selected.size} rânduri șterse`)
  }

  // ───────── Cell editing helpers ─────────
  function startEdit(rowId, field) {
    const row = tevi.find(r => r.id === rowId)
    if (!row) return
    if (!EDITABLE_FIELDS[row.tip_rand]?.has(field)) return
    setEditingCell({ rowId, field })
    setDraft(row[field] != null ? String(row[field]) : '')
  }

  function cancelEdit() {
    setEditingCell(null)
    setDraft('')
  }

  // commitEdit: saveBD + clear editing
  async function commitEdit(opts = {}) {
    if (!editingCell) return
    const { rowId, field } = editingCell
    const row = tevi.find(r => r.id === rowId)
    if (!row) { cancelEdit(); return }

    const original = row[field]
    let newValue = draft

    // Parse numeric
    if (field === 'lungime_m') {
      newValue = newValue.trim() === '' ? null : Number(newValue.replace(',', '.'))
      if (newValue != null && (isNaN(newValue) || newValue < 0)) {
        onError(`Valoare invalidă pentru ${field}: "${draft}"`)
        cancelEdit()
        return
      }
    } else if (typeof newValue === 'string') {
      newValue = newValue.trim()
      if (newValue === '') newValue = null
    }

    // Dacă nu s-a schimbat nimic, doar închidem
    if (newValue === original || (newValue == null && original == null)) {
      cancelEdit()
      return
    }

    // Construim patch
    const patch = { [field]: newValue }

    // Special: sudura_cod cu sufix R → toggle sudura_refacuta
    if (field === 'sudura_cod' && typeof newValue === 'string') {
      const parsed = parseSudura(newValue)
      patch.sudura_cod = parsed.cod
      patch.sudura_refacuta = parsed.refacuta
    }
    // Special: serie_unica gol pe teava → flag sudura_sant_pending ștearsă auto?
    // NU automat — user e responsabil. Doar logăm o avertizare la export.

    // Special: dimensiune pe curba → re-extract unghi
    if (field === 'dimensiune' && row.tip_rand === 'curba') {
      patch.unghi_curba = extractUnghi(newValue)
    }

    // Optimistic update local
    setTevi(prev => prev.map(r => r.id === rowId ? { ...r, ...patch } : r))
    cancelEdit()

    // Salvare BD
    setSaving(true)
    const { error } = await supabase.from('executie_tevi').update(patch).eq('id', rowId)
    setSaving(false)

    if (error) {
      // Revert local
      setTevi(prev => prev.map(r => r.id === rowId ? { ...r, [field]: original } : r))
      setDirty(prev => new Set(prev).add(rowId))
      onError(`Eroare salvare: ${error.message}`)
      return
    }

    // Refetch pachet (totaluri actualizate de trigger) + tevi (poz_km_m din BD)
    if (field === 'lungime_m' || field === 'sudura_cod' || field === 'pm_cod' || field === 'pa_ut_cod') {
      await Promise.all([refetchPachet(), refetchTevi()])
    } else {
      // doar text update — refresh local pentru a vedea sudura_refacuta + unghi
      const { data } = await supabase.from('executie_tevi').select('*').eq('id', rowId).single()
      if (data) setTevi(prev => prev.map(r => r.id === rowId ? data : r))
    }

    // Validare pentru câmpul nou
    if (field === 'serie_unica' || field === 'sudura_cod') {
      debouncedValidate(rowId, field, newValue)
    }

    // Nav la următoarea celulă dacă cerut
    if (opts.nav === 'tab' || opts.nav === 'enter') {
      const navTo = nextEditableCell(rowId, field, opts.nav)
      if (navTo) {
        setTimeout(() => startEdit(navTo.rowId, navTo.field), 30)
      }
    }
  }

  // ───────── Navigation: Tab → next field, Enter → next row ─────────
  function nextEditableCell(rowId, field, dir) {
    const rowIdx = tevi.findIndex(r => r.id === rowId)
    if (rowIdx === -1) return null
    const row = tevi[rowIdx]
    const allowed = EDITABLE_FIELDS[row.tip_rand]
    if (!allowed) return null

    if (dir === 'tab') {
      // next field în NAV_FIELDS care e editabil pentru row.tip_rand
      const idxField = NAV_FIELDS.indexOf(field)
      for (let i = idxField + 1; i < NAV_FIELDS.length; i++) {
        if (allowed.has(NAV_FIELDS[i])) return { rowId, field: NAV_FIELDS[i] }
      }
      // wrap la primul field din rândul următor
      if (rowIdx + 1 < tevi.length) {
        const nextRow = tevi[rowIdx + 1]
        const nextAllowed = EDITABLE_FIELDS[nextRow.tip_rand]
        for (const f of NAV_FIELDS) {
          if (nextAllowed.has(f)) return { rowId: nextRow.id, field: f }
        }
      }
      return null
    } else if (dir === 'enter') {
      // același field în rândul următor (dacă editabil acolo, altfel primul editabil)
      if (rowIdx + 1 < tevi.length) {
        const nextRow = tevi[rowIdx + 1]
        const nextAllowed = EDITABLE_FIELDS[nextRow.tip_rand]
        if (nextAllowed.has(field)) return { rowId: nextRow.id, field }
        for (const f of NAV_FIELDS) {
          if (nextAllowed.has(f)) return { rowId: nextRow.id, field: f }
        }
      }
      return null
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit({ nav: 'tab' }) }
    else if (e.key === 'Enter') { e.preventDefault(); commitEdit({ nav: 'enter' }) }
  }

  // ───────── Paste handling — Ctrl+V din Excel ─────────
  async function handlePaste(e) {
    if (!editingCell) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    // Detect multi-cell paste (tab/newline)
    const rows = text.split(/\r?\n/).filter(r => r.length > 0)
    if (rows.length === 1 && !rows[0].includes('\t')) {
      // single cell — let default behavior
      return
    }
    e.preventDefault()
    const matrix = rows.map(r => r.split('\t'))
    const { rowId, field } = editingCell
    const rowIdx = tevi.findIndex(r => r.id === rowId)
    const fieldIdx = NAV_FIELDS.indexOf(field)
    if (rowIdx === -1 || fieldIdx === -1) return

    if (!window.confirm(`Lipesc ${matrix.length} rânduri × ${matrix[0].length} celule? Suprascriu valorile existente.`)) {
      cancelEdit()
      return
    }

    setSaving(true)
    let okCount = 0, failCount = 0
    for (let i = 0; i < matrix.length; i++) {
      const targetRow = tevi[rowIdx + i]
      if (!targetRow) break
      const allowed = EDITABLE_FIELDS[targetRow.tip_rand]
      const patch = {}
      for (let j = 0; j < matrix[i].length && (fieldIdx + j) < NAV_FIELDS.length; j++) {
        const targetField = NAV_FIELDS[fieldIdx + j]
        if (!allowed.has(targetField)) continue
        let val = matrix[i][j].trim()
        if (val === '') { patch[targetField] = null; continue }
        if (targetField === 'lungime_m') {
          const n = Number(val.replace(',', '.'))
          if (!isNaN(n)) patch[targetField] = n
        } else if (targetField === 'sudura_cod') {
          const p = parseSudura(val)
          patch.sudura_cod = p.cod
          patch.sudura_refacuta = p.refacuta
        } else if (targetField === 'dimensiune' && targetRow.tip_rand === 'curba') {
          patch.dimensiune = val
          patch.unghi_curba = extractUnghi(val)
        } else {
          patch[targetField] = val
        }
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('executie_tevi').update(patch).eq('id', targetRow.id)
        if (error) failCount++
        else okCount++
      }
    }
    setSaving(false)
    cancelEdit()
    await Promise.all([refetchPachet(), refetchTevi()])
    if (failCount) onWarn(`Paste: ${okCount} OK, ${failCount} erori`)
    else onSuccess(`Paste: ${okCount} rânduri actualizate`)
  }

  // ───────── Pending șanț toggle ─────────
  async function togglePending(rowId) {
    const row = tevi.find(r => r.id === rowId)
    if (!row) return
    const newVal = !row.sudura_sant_pending
    setTevi(prev => prev.map(r => r.id === rowId ? { ...r, sudura_sant_pending: newVal } : r))
    const { error } = await supabase.from('executie_tevi').update({ sudura_sant_pending: newVal }).eq('id', rowId)
    if (error) {
      setTevi(prev => prev.map(r => r.id === rowId ? { ...r, sudura_sant_pending: !newVal } : r))
      onError('Eroare toggle pending: ' + error.message)
      return
    }
    await refetchPachet()
  }

  // ───────── Swap pozitie randuri (butoanele ↑↓) ─────────
  // Apeleaza RPC fn_executie_swap_tevi_pozitie pentru swap atomic.
  // Triggerul BD recalculeaza automat POZ KM cascade.
  async function swapPosition(rowId, direction) {
    if (swapping) return
    const idx = tevi.findIndex(r => r.id === rowId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= tevi.length) return
    const otherRow = tevi[targetIdx]
    if (!otherRow) return

    setSwapping(true)
    const { error } = await supabase.rpc('fn_executie_swap_tevi_pozitie', {
      p_id_a: rowId,
      p_id_b: otherRow.id,
    })
    setSwapping(false)
    if (error) {
      onError('Eroare reordonare: ' + error.message)
      return
    }
    // Refresh pentru poz_km_m recalculat din BD
    await refetchTevi()
  }

  // ───────── Export Centralizator Transgaz (Sub-faza E) ─────────
  // Genereaza XLSX cu xlsx-js-style → upload Storage + INSERT log + download local
  async function handleExportCentralizator() {
    if (!pachet || !tevi.length) return
    if (exporting) return

    setExporting(true)
    try {
      // 1. Load proiect (avem pachet+tronson+tevi deja in scope)
      const { data: proiect, error: errProiect } = await supabase
        .from('executie_proiecte').select('*').eq('id', pachet.proiect_id).single()
      if (errProiect) { onError('Eroare load proiect: ' + errProiect.message); return }

      // 2. Generez bytes XLSX
      const bytes = await generateCentralizatorXlsx({ pachet, tronson, proiect, tevi })
      const filename = buildCentralizatorFilename(pachet)
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      // 3. Upload in Storage bucket executie-pachete-pdf
      const ts = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const uniq = Math.random().toString(36).slice(2, 10)
      const storagePath = `${pachet.id}/${ts}_${uniq}_${filename}`
      const { error: errUp } = await supabase.storage
        .from('executie-pachete-pdf')
        .upload(storagePath, blob, { contentType: blob.type, upsert: false })

      if (errUp) {
        // Daca upload esueaza, totusi descarcam local (utilizatorul vede output)
        onWarn('Storage upload esuat (' + errUp.message + '). Descarc local.')
      } else {
        // 4. INSERT log in executie_pachete_documente
        const { data: { user } } = await supabase.auth.getUser()
        const { error: errInsDoc } = await supabase.from('executie_pachete_documente').insert({
          pachet_id: pachet.id,
          tip_document: 'centralizator',
          fisier_path: storagePath,
          fisier_nume: filename,
          fisier_size_bytes: bytes.length,
          mime_type: blob.type,
          observatii: `Export V2 (sheet 1 pixel-perfect + sheet 2 schema vizuala)`,
          uploadat_de: user?.id || null,
        })
        if (errInsDoc) onWarn('Log audit esuat (' + errInsDoc.message + ')')
        await loadExportHistory()
      }

      // 5. Download local (descarcare directa)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      onSuccess(`✓ ${filename} (${(bytes.length / 1024).toFixed(1)} KB)`)
      setShowExport(false)
    } catch (e) {
      onError('Eroare generare XLSX: ' + (e.message || String(e)))
    } finally {
      setExporting(false)
    }
  }

  // ───────── Load istoric exporturi pentru pachet ─────────
  const loadExportHistory = useCallback(async () => {
    if (!pachetId) return
    const { data } = await supabase
      .from('executie_pachete_documente')
      .select('*')
      .eq('pachet_id', pachetId)
      .eq('tip_document', 'centralizator')
      .order('uploadat_la', { ascending: false })
    if (data) setExportHistory(data)
  }, [pachetId])

  // ───────── Load istoric aprobări Transgaz ─────────
  const loadAprobariHistory = useCallback(async () => {
    if (!pachetId) return
    const { data } = await supabase
      .from('executie_pachete_documente')
      .select('*')
      .eq('pachet_id', pachetId)
      .eq('tip_document', 'pdf_aprobare_transgaz')
      .order('uploadat_la', { ascending: false })
    if (data) setAprobariHistory(data)
  }, [pachetId])

  useEffect(() => { loadExportHistory(); loadAprobariHistory() }, [loadExportHistory, loadAprobariHistory])

  // Download fisier istoric (signed URL) - reutilizat pentru ambele tipuri
  async function downloadHistory(doc) {
    const { data, error } = await supabase.storage
      .from('executie-pachete-pdf')
      .createSignedUrl(doc.fisier_path, 60)
    if (error) { onError('Eroare signed URL: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function deleteHistory(doc) {
    // 1. Șterg fișierul din Storage (best-effort, nu blochez dacă lipsește)
    const { error: errStorage } = await supabase.storage
      .from('executie-pachete-pdf')
      .remove([doc.fisier_path])
    if (errStorage) console.warn('Storage delete:', errStorage.message)
    // 2. Șterg înregistrarea din BD
    const { error: errDb } = await supabase
      .from('executie_pachete_documente')
      .delete()
      .eq('id', doc.id)
    if (errDb) { onError('Eroare ștergere: ' + errDb.message); return }
    onSuccess(`Șters: ${doc.fisier_nume}`)
    await loadExportHistory()
  }

  // ───────── Sub-faza Y: Upload PDF aprobat Transgaz ─────────
  async function handleUploadAprobat(file) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      onError('Doar fișiere PDF acceptate')
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      onError('Fișier prea mare (max 50 MB)')
      return
    }
    setUploadingAprobat(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const uniq = Math.random().toString(36).slice(2, 10)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${pachetId}/${today}_${uniq}_aprobat_${safeName}`

      // 1. Upload Storage
      const { error: errUp } = await supabase.storage
        .from('executie-pachete-pdf')
        .upload(storagePath, file, { contentType: 'application/pdf' })
      if (errUp) { onError('Upload eroare: ' + errUp.message); return }

      // 2. INSERT documente
      const { error: errDoc } = await supabase
        .from('executie_pachete_documente')
        .insert({
          pachet_id: pachetId,
          tip_document: 'pdf_aprobare_transgaz',
          fisier_path: storagePath,
          fisier_nume: file.name,
          fisier_size_bytes: file.size,
          mime_type: 'application/pdf',
        })
      if (errDoc) {
        // Rollback Storage
        await supabase.storage.from('executie-pachete-pdf').remove([storagePath])
        onError('Eroare BD documente: ' + errDoc.message)
        return
      }

      // 3. UPDATE pachet status → aprobat
      const { error: errUpd } = await supabase
        .from('executie_pachete_lansare')
        .update({
          status: 'aprobat',
          aprobat_la: new Date().toISOString(),
          pdf_aprobare_path: storagePath,
          pdf_aprobare_nume: file.name,
        })
        .eq('id', pachetId)
      if (errUpd) { onError('Eroare update pachet: ' + errUpd.message); return }

      onSuccess(`✅ Pachet APROBAT! PDF: ${file.name}`)
      await Promise.all([loadAprobariHistory(), refetchPachet()])
    } finally {
      setUploadingAprobat(false)
    }
  }

  async function deleteAprobatHistory(doc) {
    // 1. Șterg fișierul din Storage
    const { error: errStorage } = await supabase.storage
      .from('executie-pachete-pdf')
      .remove([doc.fisier_path])
    if (errStorage) console.warn('Storage delete:', errStorage.message)
    // 2. Șterg înregistrarea
    const { error: errDb } = await supabase
      .from('executie_pachete_documente')
      .delete()
      .eq('id', doc.id)
    if (errDb) { onError('Eroare ștergere: ' + errDb.message); return }

    // 3. Recalculez status pachet: dacă a rămas vreo aprobare → pun cea mai recentă; altfel revin la draft
    const { data: remaining } = await supabase
      .from('executie_pachete_documente')
      .select('*')
      .eq('pachet_id', pachetId)
      .eq('tip_document', 'pdf_aprobare_transgaz')
      .order('uploadat_la', { ascending: false })
      .limit(1)
    if (remaining && remaining.length > 0) {
      // Mai există aprobări — pun-o pe cea mai recentă ca activă
      await supabase
        .from('executie_pachete_lansare')
        .update({
          pdf_aprobare_path: remaining[0].fisier_path,
          pdf_aprobare_nume: remaining[0].fisier_nume,
          aprobat_la: remaining[0].uploadat_la,
        })
        .eq('id', pachetId)
    } else {
      // Nu mai există nicio aprobare — revin la draft
      await supabase
        .from('executie_pachete_lansare')
        .update({
          status: 'draft',
          aprobat_la: null,
          pdf_aprobare_path: null,
          pdf_aprobare_nume: null,
        })
        .eq('id', pachetId)
    }
    onSuccess(`Șters: ${doc.fisier_nume}`)
    await Promise.all([loadAprobariHistory(), refetchPachet()])
  }

  // ───────── Bulk save (pentru rânduri rămase dirty după erori) ─────────
  async function saveBulkDirty() {
    if (!dirty.size) {
      onSuccess('Nimic de salvat')
      return
    }
    setBulkSaving(true)
    let okCount = 0, failCount = 0
    for (const rowId of dirty) {
      const row = tevi.find(r => r.id === rowId)
      if (!row) continue
      // Trimit întregul rând (mai puține edge cases pentru bulk)
      const patch = {
        lot: row.lot, serie_unica: row.serie_unica, tip: row.tip,
        dimensiune: row.dimensiune, sarja: row.sarja, lungime_m: row.lungime_m,
        sudura_cod: row.sudura_cod, sudura_refacuta: row.sudura_refacuta,
        sudura_sant_pending: row.sudura_sant_pending,
        pm_cod: row.pm_cod, pa_ut_cod: row.pa_ut_cod, ut_cod: row.ut_cod,
        observatii: row.observatii, unghi_curba: row.unghi_curba,
      }
      const { error } = await supabase.from('executie_tevi').update(patch).eq('id', rowId)
      if (error) failCount++
      else okCount++
    }
    setBulkSaving(false)
    setDirty(new Set())
    await Promise.all([refetchPachet(), refetchTevi()])
    if (failCount) onWarn(`Salvare: ${okCount} OK, ${failCount} erori`)
    else onSuccess(`${okCount} rânduri salvate`)
  }

  // ───────── Validation summary ─────────
  const validationErrors = useMemo(() => {
    return Object.values(validation).filter(v => v && v.ok === false).length
  }, [validation])

  // ───────── LOADING ─────────
  if (loading) {
    return <div style={{ padding: 40, color: G.muted, fontSize: 14 }}>Se încarcă pachetul...</div>
  }
  if (!pachet) {
    return (
      <div style={{...S.card, padding: 40, textAlign:'center'}}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>❌</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Pachetul nu a fost găsit</div>
        <button style={S.btnS} onClick={onClose}>← Înapoi la listă</button>
      </div>
    )
  }

  // ───────── RENDER ─────────
  const totalLungime = tevi.reduce((s, t) => s + Number(t.lungime_m || 0), 0)
  const nrPending = tevi.filter(t => t.sudura_sant_pending).length

  return (
    <div>
      {/* HEADER PACHET */}
      <div style={{...S.card, padding:'16px 20px', marginBottom: 12}}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: 12, flexWrap:'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display:'flex', alignItems:'center', gap: 10, flexWrap:'wrap', marginBottom: 6 }}>
              <button onClick={onClose} style={{...S.btnS, padding:'6px 10px'}}>
                ← Înapoi
              </button>
              <span style={{ fontSize: 18, fontWeight: 700, fontFamily:'monospace', color: G.purple }}>
                📦 {pachet.cod_document_full}
              </span>
              {pachet.revizie > 0 && (
                <span style={{...S.badge, background: G.yellow+'22', color: G.yellow, fontSize: 12, padding: '3px 10px'}}>
                  rev.{pachet.revizie}
                </span>
              )}
              {pachet.status === 'aprobat' && (
                <span style={{...S.badge, background: G.green+'22', color: G.green, fontSize: 12, padding: '3px 10px'}}>
                  ✅ APROBAT TRANSGAZ {pachet.aprobat_la && `· ${fmtDate(pachet.aprobat_la.slice(0,10))}`}
                </span>
              )}
              {pachet.respins_la && (
                <span style={{...S.badge, background: G.red+'22', color: G.red}}>Respins</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: G.muted }}>
              Tronson <span style={{ color: G.purple, fontWeight: 600 }}>{tronson?.cod || '?'}</span>
              {' · '}KM start: <span style={{ fontFamily:'monospace' }}>{fmtKm(pachet.km_start_m)}</span>
              {' · '}Lansare: {fmtDate(pachet.data_lansare)}
              {' · '}<span style={{ color: G.text, fontWeight: 600 }}>{tevi.length}</span> elemente
              {' · '}<span style={{ color: G.text, fontWeight: 600 }}>{totalLungime.toFixed(2)}m</span>
              {nrPending > 0 && <> · <span style={{ color: G.orange, fontWeight: 600 }}>{nrPending}</span> pending șanț</>}
            </div>
            {pachet.observatii && (
              <div style={{ fontSize: 12, color: G.muted, marginTop: 8, fontStyle:'italic' }}>
                ℹ {pachet.observatii}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TOOLBAR */}
      <div style={{...S.card, padding:'10px 14px', marginBottom: 12, display:'flex', alignItems:'center', gap: 6, flexWrap:'wrap'}}>
        <button onClick={() => addRow('teava')} style={{...S.btnS, padding:'6px 12px', borderColor: G.blue, color: G.blue, background: G.blue+'14'}}>
          ➕ Țeavă
        </button>
        <button onClick={() => addRow('curba')} style={{...S.btnS, padding:'6px 12px', borderColor: G.orange, color: G.orange, background: G.orange+'14'}}>
          ➕ Curbă CIC
        </button>
        <button onClick={() => addRow('legare')} style={{...S.btnS, padding:'6px 12px', borderColor: G.green, color: G.green, background: G.green+'14'}}>
          ➕ Legare
        </button>
        <button onClick={() => addRow('separator')} style={{...S.btnS, padding:'6px 12px'}}>
          ➕ Separator
        </button>

        <div style={{ width: 1, height: 24, background: G.border, margin: '0 4px' }} />

        <button
          onClick={deleteBulk}
          disabled={!selected.size}
          style={{...S.btnS, padding:'6px 12px', opacity: selected.size ? 1 : 0.4, cursor: selected.size ? 'pointer' : 'not-allowed', borderColor: selected.size ? G.red : G.border, color: selected.size ? G.red : G.muted}}
        >
          🗑 Șterge ({selected.size})
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setShowImport(true)}
          style={{...S.btnS, padding:'6px 12px', borderColor: G.purple, color: G.purple, background: G.purple+'14'}}
          title="Import bulk din Excel Centralizator Transgaz"
        >
          📥 Import Excel
        </button>
        <button
          style={{ ...S.btnS, padding:'6px 12px', opacity: 0.5, cursor:'not-allowed' }}
          title="Disponibil în Faza C"
          disabled
        >
          🚧 Completează la șanț
        </button>
        <button
          onClick={() => setShowExport(true)}
          disabled={!tevi.length || exporting}
          style={{
            ...S.btnS, padding:'6px 12px',
            borderColor: tevi.length ? G.green : G.border,
            color: tevi.length ? G.green : G.muted,
            background: tevi.length ? G.green+'14' : 'transparent',
            opacity: exporting ? 0.6 : (tevi.length ? 1 : 0.5),
            cursor: (!tevi.length || exporting) ? 'not-allowed' : 'pointer',
          }}
          title={tevi.length ? 'Generează Centralizator XLSX pentru Transgaz' : 'Adaugă țevi în pachet întâi'}
        >
          {exporting ? '⏳ Generez...' : '📤 Export Transgaz'}
        </button>
        <button
          onClick={() => setShowAprobat(true)}
          style={{
            ...S.btnS, padding:'6px 12px',
            borderColor: pachet.status === 'aprobat' ? G.green : G.purple,
            color: pachet.status === 'aprobat' ? G.green : G.purple,
            background: (pachet.status === 'aprobat' ? G.green : G.purple) + '14',
            fontWeight: 600,
          }}
          title="Upload PDF aprobat de Transgaz"
        >
          {pachet.status === 'aprobat' ? `✅ Aprobat (${aprobariHistory.length})` : `📥 PDF aprobat${aprobariHistory.length ? ` (${aprobariHistory.length})` : ''}`}
        </button>
        <button
          onClick={saveBulkDirty}
          disabled={!dirty.size || bulkSaving}
          style={{...S.btnP, padding:'6px 14px', opacity: dirty.size ? 1 : 0.5, cursor: dirty.size ? 'pointer' : 'not-allowed'}}
        >
          {bulkSaving ? 'Salvez...' : `💾 Salvează (${dirty.size})`}
        </button>
      </div>

      {/* TABEL EDITOR */}
      <div style={{...S.card, overflow:'hidden'}}>
        {tevi.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign:'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Pachet gol</div>
            <div style={{ color: G.muted, fontSize: 13, marginBottom: 16 }}>
              Adaugă primul rând cu butoanele din toolbar (sau așteaptă Faza B pentru import Excel)
            </div>
            <div style={{ display:'inline-flex', gap: 8 }}>
              <button onClick={() => addRow('teava')} style={{...S.btnP, padding:'8px 14px'}}>➕ Prima țeavă</button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX:'auto', maxHeight:'calc(100vh - 280px)' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12, minWidth: 1356 }}>
              <thead style={{ position:'sticky', top: 0, background: G.surface, zIndex: 10 }}>
                <tr style={{ borderBottom: `1px solid ${G.border}` }}>
                  {COL_DEFS.map(col => (
                    <th key={col.key} style={{
                      ...thStyle,
                      width: col.width,
                      minWidth: col.width,
                      textAlign: col.align || 'left',
                      padding: '8px 8px',
                    }}>
                      {col.key === '_select' ? (
                        <input
                          type="checkbox"
                          checked={selected.size === tevi.length && tevi.length > 0}
                          onChange={(e) => setSelected(e.target.checked ? new Set(tevi.map(t => t.id)) : new Set())}
                        />
                      ) : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teviWithPozKm.map((row, idx) => (
                  <EditorRow
                    key={row.id}
                    row={row}
                    isEditing={editingCell?.rowId === row.id ? editingCell.field : null}
                    draft={draft}
                    setDraft={setDraft}
                    onStartEdit={(field) => startEdit(row.id, field)}
                    onCommit={commitEdit}
                    onCancel={cancelEdit}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    validation={validation}
                    onValidate={(field, val) => debouncedValidate(row.id, field, val)}
                    selected={selected.has(row.id)}
                    onToggleSelect={() => setSelected(prev => {
                      const n = new Set(prev)
                      if (n.has(row.id)) n.delete(row.id); else n.add(row.id)
                      return n
                    })}
                    onDelete={() => deleteRow(row.id)}
                    onTogglePending={() => togglePending(row.id)}
                    onSwapUp={() => swapPosition(row.id, 'up')}
                    onSwapDown={() => swapPosition(row.id, 'down')}
                    isFirst={idx === 0}
                    isLast={idx === teviWithPozKm.length - 1}
                    swapping={swapping}
                    dirty={dirty.has(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FOOTER STATUS */}
      <div style={{ padding: '12px 16px', marginTop: 8, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 12, color: G.muted, flexWrap:'wrap', gap: 8 }}>
        <div style={{ display:'flex', gap: 14, flexWrap:'wrap' }}>
          {saving && <span style={{ color: G.blue }}>⏳ Salvez...</span>}
          {!saving && dirty.size === 0 && <span style={{ color: G.green }}>✓ Toate salvate</span>}
          {dirty.size > 0 && <span style={{ color: G.yellow }}>⚠ {dirty.size} nesalvate</span>}
          <span>{tevi.length} rânduri</span>
          {validationErrors > 0 && <span style={{ color: G.red }}>✕ {validationErrors} validări eșuate</span>}
        </div>
        <div style={{ fontFamily:'monospace', fontSize: 11 }}>
          Click pe celulă · Tab→next · Enter→jos · Esc→cancel · Ctrl+V→paste Excel
        </div>
      </div>

      {/* MODAL: Import Excel */}
      {showImport && (
        <ImportExcelModal
          pachet={pachet}
          tronson={tronson}
          onClose={() => setShowImport(false)}
          onSuccess={(msg) => {
            setShowImport(false)
            onSuccess(msg)
            // Refresh complet după import
            refetchPachet()
            refetchTevi()
          }}
          onError={onError}
          onWarn={onWarn}
        />
      )}

      {/* MODAL: Export Centralizator Transgaz */}
      {showExport && (
        <ExportCentralizatorModal
          pachet={pachet}
          tronson={tronson}
          tevi={tevi}
          exporting={exporting}
          history={exportHistory}
          onConfirm={handleExportCentralizator}
          onClose={() => setShowExport(false)}
          onDownloadHistory={downloadHistory}
          onDeleteHistory={deleteHistory}
        />
      )}

      {/* MODAL: Upload PDF aprobat Transgaz */}
      {showAprobat && (
        <UploadAprobatModal
          pachet={pachet}
          tronson={tronson}
          uploading={uploadingAprobat}
          history={aprobariHistory}
          onUpload={handleUploadAprobat}
          onClose={() => setShowAprobat(false)}
          onDownloadHistory={downloadHistory}
          onDeleteHistory={deleteAprobatHistory}
        />
      )}
    </div>
  )
}

// ===========================================================================
// EXPORT CENTRALIZATOR MODAL — confirmare + istoric versiuni
// ===========================================================================

function ExportCentralizatorModal({ pachet, tronson, tevi, exporting, history, onConfirm, onClose, onDownloadHistory, onDeleteHistory }) {
  const teviCount = tevi.length
  const totalLungime = tevi.reduce((s, t) => s + Number(t.lungime_m || 0), 0)
  const pendingSant = tevi.filter(t => t.sudura_sant_pending).length
  const filename = `${pachet.cod_document_full}${pachet.revizie > 0 ? `_rev${pachet.revizie}` : '_rev0'}_Centralizator.xlsx`

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.75)', display:'flex',
      alignItems:'center', justifyContent:'center', zIndex:1000, padding:20,
    }}>
      <div style={{
        background: G.surface, borderRadius:12, border:`1px solid ${G.border}`,
        width:'100%', maxWidth:640, maxHeight:'90vh', overflowY:'auto',
      }}>
        {/* HEADER */}
        <div style={{ padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:17, fontWeight:700, color:G.green }}>📤 Export Centralizator Transgaz</div>
            <div style={{ fontSize:12, color:G.muted, marginTop:4, fontFamily:'monospace' }}>
              {pachet.cod_document_full}{pachet.revizie > 0 ? ` rev.${pachet.revizie}` : ''} · Tronson {tronson?.cod}
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'6px 10px' }}>✕</button>
        </div>

        {/* CONFIRM ZONE */}
        <div style={{ padding:'18px 24px' }}>
          <div style={{ background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:14, marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Conținut export:</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, fontSize:12 }}>
              <div>
                <div style={{ color:G.muted }}>Rânduri totale</div>
                <div style={{ fontWeight:700, fontSize:16 }}>{teviCount}</div>
              </div>
              <div>
                <div style={{ color:G.muted }}>Lungime totală</div>
                <div style={{ fontWeight:700, fontSize:16 }}>{totalLungime.toFixed(2)} m</div>
              </div>
              <div>
                <div style={{ color:G.muted }}>Pending șanț</div>
                <div style={{ fontWeight:700, fontSize:16, color: pendingSant > 0 ? G.orange : G.text }}>{pendingSant}</div>
              </div>
            </div>
            <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${G.border2}`, fontSize:12 }}>
              <div><span style={{ color:G.muted }}>Fișier:</span> <span style={{ fontFamily:'monospace', color:G.green }}>{filename}</span></div>
              <div style={{ marginTop:4 }}>
                <span style={{ color:G.muted }}>Conține:</span> Sheet 1 CENTRALIZATOR pixel-perfect + Sheet 2 IZOMETRIE cu schema vizuală (blocuri 6-col/țeavă) + lookup table.
              </div>
            </div>
          </div>

          {/* ISTORIC EXPORTURI */}
          {history && history.length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8, color:G.muted }}>
                📜 Istoric exporturi ({history.length})
              </div>
              <div style={{ background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, maxHeight:200, overflowY:'auto' }}>
                {history.map(doc => (
                  <div key={doc.id} style={{
                    padding:'8px 12px', borderBottom:`1px solid ${G.border2}`,
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                  }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:12, fontFamily:'monospace', color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {doc.fisier_nume}
                      </div>
                      <div style={{ fontSize:10, color:G.muted, marginTop:2 }}>
                        {doc.tip_document} · {fmtDate(doc.uploadat_la?.slice(0, 10))} · {(doc.fisier_size_bytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <button
                        onClick={() => onDownloadHistory(doc)}
                        style={{ ...S.btnS, padding:'4px 10px', fontSize:11, borderColor:G.blue, color:G.blue }}
                      >
                        ⬇ Descarcă
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Șterge definitiv "${doc.fisier_nume}"?\n\nFișierul va fi eliminat din Storage și din istoric.`)) {
                            onDeleteHistory(doc)
                          }
                        }}
                        style={{ ...S.btnS, padding:'4px 8px', fontSize:11, borderColor:G.red, color:G.red }}
                        title="Șterge"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INFO */}
          <div style={{ background:G.purple+'11', border:`1px solid ${G.purple}33`, borderRadius:8, padding:12, fontSize:11, color:G.muted, lineHeight:1.6 }}>
            La generare:
            <ul style={{ margin:'6px 0 0 16px', padding:0 }}>
              <li>Fișierul XLSX se descarcă automat în browser</li>
              <li>O copie e salvată în Storage (bucket <code style={{ color:G.purple }}>executie-pachete-pdf</code>)</li>
              <li>Audit log în <code style={{ color:G.purple }}>executie_pachete_documente</code></li>
            </ul>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ padding:'14px 24px', borderTop:`1px solid ${G.border}`, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button onClick={onClose} style={{...S.btnS, padding:'9px 18px'}}>Anulează</button>
          <button
            onClick={onConfirm}
            disabled={exporting || !teviCount}
            style={{
              ...S.btnP, padding:'9px 20px',
              background: G.green, color:'#fff',
              opacity: exporting || !teviCount ? 0.5 : 1,
              cursor: exporting || !teviCount ? 'not-allowed' : 'pointer',
            }}
          >
            {exporting ? '⏳ Generez...' : '📤 Generează & Descarcă'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// UPLOAD APROBAT MODAL — Sub-faza Y: upload PDF aprobat de Transgaz
// ===========================================================================

function UploadAprobatModal({ pachet, tronson, uploading, history, onUpload, onClose, onDownloadHistory, onDeleteHistory }) {
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const isAprobat = pachet.status === 'aprobat'

  function handleFileSelect(f) {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
      alert('Doar fișiere PDF acceptate')
      return
    }
    if (f.size > 50 * 1024 * 1024) {
      alert('Fișier prea mare (max 50 MB)')
      return
    }
    setFile(f)
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    handleFileSelect(f)
  }

  async function handleConfirm() {
    if (!file) return
    await onUpload(file)
    setFile(null)
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex: 1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding: 20,
    }}>
      <div style={{
        background: G.card, border:`1px solid ${G.border}`, borderRadius: 12,
        maxWidth: 640, width:'100%', maxHeight:'90vh', display:'flex', flexDirection:'column',
      }}>
        {/* HEADER */}
        <div style={{ padding:'18px 24px', borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: G.green }}>
              ✅ Upload PDF aprobat Transgaz
            </div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 4, fontFamily:'monospace' }}>
              {pachet.cod_document_full} · Tronson {tronson?.cod || '?'}
            </div>
          </div>
          <button onClick={onClose} style={{...S.btnS, padding:'6px 12px', fontSize: 18}}>×</button>
        </div>

        {/* CONȚINUT */}
        <div style={{ padding:'18px 24px', overflowY:'auto' }}>
          {/* Status curent */}
          <div style={{ background: G.bg, border:`1px solid ${G.border}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 4 }}>Status pachet</div>
            <div style={{ display:'flex', alignItems:'center', gap: 10, flexWrap:'wrap' }}>
              <span style={{
                ...S.badge, padding:'4px 12px', fontSize: 13, fontWeight: 600,
                background: (isAprobat ? G.green : G.muted) + '22',
                color: isAprobat ? G.green : G.muted,
              }}>
                {isAprobat ? '✅ APROBAT' : '📝 DRAFT'}
              </span>
              {isAprobat && pachet.aprobat_la && (
                <span style={{ fontSize: 12, color: G.muted }}>
                  aprobat la {fmtDate(pachet.aprobat_la.slice(0, 10))}
                </span>
              )}
              {isAprobat && pachet.pdf_aprobare_nume && (
                <span style={{ fontSize: 12, color: G.muted, fontFamily:'monospace' }}>
                  · {pachet.pdf_aprobare_nume}
                </span>
              )}
            </div>
          </div>

          {/* DROP ZONE */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? G.green : (file ? G.green : G.border)}`,
              borderRadius: 10, padding: '28px 20px', textAlign:'center', cursor:'pointer',
              background: dragOver ? G.green+'14' : (file ? G.green+'08' : G.bg),
              transition: 'all 0.15s',
              marginBottom: 14,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={e => handleFileSelect(e.target.files[0])}
              style={{ display:'none' }}
            />
            {file ? (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: G.green, marginBottom: 4, wordBreak:'break-all' }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 12, color: G.muted }}>
                  {(file.size / 1024).toFixed(1)} KB · gata de upload
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null) }}
                  style={{...S.btnS, padding:'4px 10px', fontSize: 11, marginTop: 10, borderColor: G.red, color: G.red}}
                >
                  Schimbă fișier
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }}>📥</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: G.text, marginBottom: 4 }}>
                  Drag & drop PDF aprobat de Transgaz aici
                </div>
                <div style={{ fontSize: 12, color: G.muted }}>
                  sau click pentru a alege fișierul (max 50 MB)
                </div>
              </div>
            )}
          </div>

          {/* ISTORIC APROBĂRI */}
          {history && history.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: G.muted }}>
                📜 Istoric aprobări ({history.length})
              </div>
              <div style={{ background: G.bg, border:`1px solid ${G.border}`, borderRadius: 8, maxHeight: 200, overflowY:'auto' }}>
                {history.map(doc => (
                  <div key={doc.id} style={{
                    padding:'8px 12px', borderBottom:`1px solid ${G.border2}`,
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontFamily:'monospace', color: G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {doc.fisier_nume}
                      </div>
                      <div style={{ fontSize: 10, color: G.muted, marginTop: 2 }}>
                        {fmtDate(doc.uploadat_la?.slice(0, 10))} · {(doc.fisier_size_bytes / 1024).toFixed(1)} KB
                      </div>
                    </div>
                    <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
                      <button
                        onClick={() => onDownloadHistory(doc)}
                        style={{...S.btnS, padding:'4px 10px', fontSize: 11, borderColor: G.blue, color: G.blue}}
                      >
                        ⬇ Descarcă
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Șterge definitiv "${doc.fisier_nume}"?\n\nDacă e ultima aprobare, pachetul revine la status DRAFT.`)) {
                            onDeleteHistory(doc)
                          }
                        }}
                        style={{...S.btnS, padding:'4px 8px', fontSize: 11, borderColor: G.red, color: G.red}}
                        title="Șterge"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INFO */}
          <div style={{ background: G.green+'11', border:`1px solid ${G.green}33`, borderRadius: 8, padding: 12, fontSize: 11, color: G.muted, lineHeight: 1.6 }}>
            La upload:
            <ul style={{ margin:'6px 0 0 16px', padding: 0 }}>
              <li>PDF-ul e salvat în Storage (bucket <code style={{ color: G.green }}>executie-pachete-pdf</code>)</li>
              <li>Pachetul devine <strong style={{ color: G.green }}>APROBAT</strong> → gata de lansare în teren</li>
              <li>Audit log în <code style={{ color: G.green }}>executie_pachete_documente</code></li>
              <li>Istoricul aprobărilor e păstrat (poți avea revizii multiple)</li>
            </ul>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ padding:'14px 24px', borderTop:`1px solid ${G.border}`, display:'flex', justifyContent:'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{...S.btnS, padding:'9px 18px'}}>Anulează</button>
          <button
            onClick={handleConfirm}
            disabled={!file || uploading}
            style={{
              ...S.btnP, padding:'9px 20px',
              background: G.green, color:'#fff',
              opacity: !file || uploading ? 0.5 : 1,
              cursor: !file || uploading ? 'not-allowed' : 'pointer',
            }}
          >
            {uploading ? '⏳ Upload...' : '✅ Salvează & Marchează aprobat'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// EDITOR ROW — un rând din tabel cu render condițional per coloană
// ===========================================================================

function EditorRow({ row, isEditing, draft, setDraft, onStartEdit, onCommit, onCancel, onKeyDown, onPaste, validation, onValidate, selected, onToggleSelect, onDelete, onTogglePending, onSwapUp, onSwapDown, isFirst, isLast, swapping, dirty }) {
  const rowBg = row.sudura_sant_pending ? G.yellowDim+'44' :
                row.pachet_sudura_sant_id ? G.purpleDim+'44' :
                dirty ? G.yellowDim+'22' : 'transparent'

  // Separator → 1 colspan large
  if (row.tip_rand === 'separator') {
    return (
      <tr style={{ background: G.surface+'66', borderBottom: `1px solid ${G.border2}` }}>
        <td style={{...tdStyle, padding:'6px 8px', textAlign:'center'}}>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        </td>
        <td style={{...tdStyle, padding:'6px 8px', color: G.muted, fontFamily:'monospace', textAlign:'right'}}>{row.poz_in_pachet}</td>
        <td style={{ padding:'6px 8px' }}>
          <span style={{...S.badge, background: G.muted+'22', color: G.muted}}>separator</span>
        </td>
        <td colSpan={COL_DEFS.length - 4} style={{ padding:'6px 14px', textAlign:'center', color: G.muted, fontStyle:'italic', fontSize: 11 }}>
          {isEditing === 'observatii' ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={() => onCommit()}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder="— gap fizic în traseu mozaic —"
              style={{...S.input, padding:'4px 8px', fontSize: 11, background: G.bg}}
            />
          ) : (
            <div onClick={() => onStartEdit('observatii')} style={{ cursor:'pointer', padding: 4 }}>
              {row.observatii || '— gap fizic în traseu mozaic —'}
            </div>
          )}
        </td>
        <td style={{...tdStyle, padding:'6px 4px', textAlign:'center'}}>
          <div style={{ display:'flex', justifyContent:'center', gap: 2, alignItems:'center' }}>
            <button
              onClick={onSwapUp}
              disabled={isFirst || swapping}
              title="Mută rândul sus"
              style={{
                background:'transparent', border:`1px solid ${isFirst ? G.border : G.purple}`,
                color: isFirst ? G.dim : G.purple,
                cursor: (isFirst || swapping) ? 'not-allowed' : 'pointer',
                fontSize: 11, padding:'1px 5px', borderRadius: 3, lineHeight: 1,
                opacity: (isFirst || swapping) ? 0.35 : 1,
              }}
            >↑</button>
            <button
              onClick={onSwapDown}
              disabled={isLast || swapping}
              title="Mută rândul jos"
              style={{
                background:'transparent', border:`1px solid ${isLast ? G.border : G.purple}`,
                color: isLast ? G.dim : G.purple,
                cursor: (isLast || swapping) ? 'not-allowed' : 'pointer',
                fontSize: 11, padding:'1px 5px', borderRadius: 3, lineHeight: 1,
                opacity: (isLast || swapping) ? 0.35 : 1,
              }}
            >↓</button>
            <button
              onClick={onDelete}
              title="Șterge rând"
              style={{ background:'transparent', border:'none', color: G.red, cursor:'pointer', fontSize: 14, padding: 2 }}
            >🗑</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background: rowBg, borderBottom: `1px solid ${G.border2}` }}>
      {COL_DEFS.map(col => (
        <Cell
          key={col.key}
          row={row}
          col={col}
          isEditing={isEditing === col.key}
          draft={draft}
          setDraft={setDraft}
          onStartEdit={() => onStartEdit(col.key)}
          onCommit={onCommit}
          onCancel={onCancel}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          validation={validation}
          onValidate={(val) => col.validate && onValidate(col.key, val)}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onDelete={onDelete}
          onTogglePending={onTogglePending}
          onSwapUp={onSwapUp}
          onSwapDown={onSwapDown}
          isFirst={isFirst}
          isLast={isLast}
          swapping={swapping}
        />
      ))}
    </tr>
  )
}

// ===========================================================================
// CELL — celula individuală cu render condițional editare
// ===========================================================================

function Cell({ row, col, isEditing, draft, setDraft, onStartEdit, onCommit, onCancel, onKeyDown, onPaste, validation, onValidate, selected, onToggleSelect, onDelete, onTogglePending, onSwapUp, onSwapDown, isFirst, isLast, swapping }) {
  const vKey = `${row.id}:${col.key}`
  const vState = validation[vKey]
  const allowed = EDITABLE_FIELDS[row.tip_rand]
  const isEditableField = col.edit && allowed?.has(col.key)

  // Celula _select
  if (col.key === '_select') {
    return (
      <td style={{...tdStyle, padding:'6px 8px', textAlign:'center', width: col.width}}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>
    )
  }

  // Celula poz_in_pachet
  if (col.key === 'poz_in_pachet') {
    return (
      <td style={{...tdStyle, padding:'6px 8px', textAlign:'right', color: G.muted, fontFamily:'monospace', fontSize: 11, width: col.width}}>
        {row.poz_in_pachet}
      </td>
    )
  }

  // Celula tip_rand (badge readonly)
  if (col.key === 'tip_rand') {
    const c = TIP_RAND_COLORS[row.tip_rand] || G.muted
    return (
      <td style={{ padding:'6px 8px', width: col.width }}>
        <span style={{...S.badge, background: c+'22', color: c, fontSize: 10}}>
          {row.tip_rand}
        </span>
        {row.sudura_sant_pending && (
          <span
            onClick={onTogglePending}
            title="Click pentru a anula pending"
            style={{...S.badge, background: G.orange+'33', color: G.orange, fontSize: 10, marginLeft: 4, cursor:'pointer'}}
          >
            🚧 șanț
          </span>
        )}
        {row.sudura_refacuta && (
          <span style={{...S.badge, background: G.red+'33', color: G.red, fontSize: 10, marginLeft: 4}}>R</span>
        )}
      </td>
    )
  }

  // Celula POZ KM (preview readonly)
  if (col.key === '_poz_km') {
    return (
      <td style={{...tdStyle, padding:'6px 8px', textAlign:'right', color: G.muted, fontFamily:'monospace', fontSize: 11, width: col.width}}>
        {fmtKm(row._poz_km)}
      </td>
    )
  }

  // Celula _actions (swap up/down + pending toggle + delete)
  if (col.key === '_actions') {
    return (
      <td style={{...tdStyle, padding:'6px 4px', textAlign:'center', width: col.width}}>
        <div style={{ display:'flex', justifyContent:'center', gap: 5, alignItems:'center' }}>
          <button
            onClick={onSwapUp}
            disabled={isFirst || swapping}
            title="Mută rândul sus"
            style={{
              background:'transparent', border:`1px solid ${isFirst ? G.border : G.purple}`,
              color: isFirst ? G.dim : G.purple,
              cursor: (isFirst || swapping) ? 'not-allowed' : 'pointer',
              fontSize: 16, padding:'4px 9px', borderRadius: 4, lineHeight: 1,
              opacity: (isFirst || swapping) ? 0.35 : 1,
              minWidth: 28, fontWeight: 600,
            }}
          >↑</button>
          <button
            onClick={onSwapDown}
            disabled={isLast || swapping}
            title="Mută rândul jos"
            style={{
              background:'transparent', border:`1px solid ${isLast ? G.border : G.purple}`,
              color: isLast ? G.dim : G.purple,
              cursor: (isLast || swapping) ? 'not-allowed' : 'pointer',
              fontSize: 16, padding:'4px 9px', borderRadius: 4, lineHeight: 1,
              opacity: (isLast || swapping) ? 0.35 : 1,
              minWidth: 28, fontWeight: 600,
            }}
          >↓</button>
          {(row.tip_rand === 'teava' || row.tip_rand === 'curba') && (
            <button
              onClick={onTogglePending}
              title={row.sudura_sant_pending ? 'Anulează pending șanț' : 'Marchează pending șanț'}
              style={{
                background:'transparent', border:`1px solid ${row.sudura_sant_pending ? G.orange : G.border}`,
                color: row.sudura_sant_pending ? G.orange : G.muted,
                cursor:'pointer', fontSize: 18, padding:'3px 8px', borderRadius: 4, lineHeight: 1,
              }}
            >🚧</button>
          )}
          <button
            onClick={onDelete}
            title="Șterge rând"
            style={{ background:'transparent', border:'none', color: G.red, cursor:'pointer', fontSize: 20, padding: '3px 5px', lineHeight: 1 }}
          >🗑</button>
        </div>
      </td>
    )
  }

  // Celule data readonly (rând non-editabil pe acest câmp)
  if (!isEditableField) {
    return (
      <td style={{...tdStyle, padding:'6px 8px', color: G.dim, fontStyle:'italic', width: col.width}}>
        {row[col.key] || '—'}
      </td>
    )
  }

  // ────── Celulă editabilă ──────
  const value = row[col.key]
  const displayValue = value == null || value === '' ? '' : String(value)

  // Render specific pentru sudură cu R + PM warning
  const isSuduraCell = col.key === 'sudura_cod'
  const showR = isSuduraCell && row.sudura_refacuta
  const isPMWarning = (col.key === 'pm_cod' || col.key === 'pa_ut_cod') && row.sudura_cod && !row[col.key] && !row.sudura_sant_pending
  const isPendingPM = (col.key === 'pm_cod' || col.key === 'pa_ut_cod' || col.key === 'sudura_cod') && row.sudura_sant_pending

  if (isEditing) {
    const borderColor = vState && vState.ok === false ? G.red : G.purple
    return (
      <td style={{ padding: 2, width: col.width, position:'relative' }}>
        <input
          autoFocus
          type={col.edit === 'number' ? 'number' : 'text'}
          step={col.edit === 'number' ? '0.01' : undefined}
          value={draft}
          onChange={e => {
            setDraft(e.target.value)
            if (col.validate) onValidate(e.target.value)
          }}
          onBlur={() => onCommit()}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          style={{
            width:'100%', padding:'5px 6px', background: G.bg, color: G.text,
            border:`2px solid ${borderColor}`, borderRadius: 4, outline:'none',
            fontSize: 12, fontFamily: col.mono ? 'monospace' : 'inherit',
            textAlign: col.align || 'left',
          }}
        />
        {vState && vState.ok === false && (
          <div style={{
            position:'absolute', top:'100%', left:0, marginTop: 2, zIndex: 20,
            background: G.red, color:'#fff', padding:'4px 8px', borderRadius: 4,
            fontSize: 11, whiteSpace:'nowrap', boxShadow:'0 4px 12px rgba(0,0,0,.4)',
          }}>
            ⚠ {vState.msg}
          </div>
        )}
      </td>
    )
  }

  // Celulă display (click → edit)
  const cellColor = isPendingPM ? G.orange : isPMWarning ? G.yellow : (col.mono ? G.text : G.text)
  const cellBg = isPMWarning ? G.yellowDim+'66' : (vState && vState.ok === false ? G.redDim+'44' : 'transparent')

  return (
    <td
      onClick={onStartEdit}
      style={{
        padding:'6px 8px', cursor:'cell', width: col.width,
        fontFamily: col.mono ? 'monospace' : 'inherit', fontSize: 12,
        color: cellColor, background: cellBg,
        textAlign: col.align || 'left',
        position:'relative',
      }}
      title={vState && vState.ok === false ? `⚠ ${vState.msg}` : (isPMWarning ? `${col.label} lipsește deși SUDURA e populat` : '')}
    >
      {isPendingPM && !displayValue ? (
        <span style={{ color: G.orange, fontStyle:'italic' }}>pending</span>
      ) : displayValue || <span style={{ color: G.dim }}>—</span>}
      {showR && <span style={{ color: G.red, fontWeight: 700, marginLeft: 4 }}>R</span>}
      {col.key === 'dimensiune' && row.unghi_curba && (
        <span style={{ color: G.orange, marginLeft: 4, fontSize: 10 }}>· {row.unghi_curba}</span>
      )}
      {vState && vState.ok === false && (
        <span style={{ position:'absolute', top: 2, right: 2, color: G.red, fontSize: 11 }}>⚠</span>
      )}
    </td>
  )
}

// ===========================================================================
// MODAL: Creare pachet nou (NEATINS din Faza 1)
// ===========================================================================

function NoPachetModal({ tronson, proiectId, onClose, onSuccess, onError }) {
  const [form, setForm] = useState({
    revizie: 0,
    km_start_m: tronson.km_start_m || '',
    data_lansare: new Date().toISOString().slice(0, 10),
    observatii: '',
    parent_pachet_id: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload = {
      proiect_id: proiectId,
      tronson_id: tronson.id,
      revizie: Number(form.revizie) || 0,
      km_start_m: form.km_start_m === '' ? null : Number(form.km_start_m),
      data_lansare: form.data_lansare || null,
      observatii: form.observatii || null,
      parent_pachet_id: form.parent_pachet_id || null,
    }
    const { data, error } = await supabase
      .from('executie_pachete_lansare')
      .insert(payload)
      .select()
      .single()
    setSaving(false)
    if (error) {
      onError('Eroare creare pachet: ' + error.message)
      return
    }
    onSuccess(data)
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
        + Pachet nou pe <span style={{ color: G.purple }}>{tronson.cod}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Revizie">
          <input
            type="number" min={0} value={form.revizie}
            onChange={e => setForm({...form, revizie: e.target.value})}
            style={S.input}
          />
        </Field>
        <Field label="Km start (m) — ex: 936 = 0+936">
          <input
            type="number" value={form.km_start_m}
            onChange={e => setForm({...form, km_start_m: e.target.value})}
            placeholder="ex: 936"
            style={S.input}
          />
        </Field>
        <Field label="Data lansare">
          <input
            type="date" value={form.data_lansare}
            onChange={e => setForm({...form, data_lansare: e.target.value})}
            style={S.input}
          />
        </Field>
        <Field label="Cod document (auto)">
          <input
            disabled
            value="generat automat după save"
            style={{ ...S.input, opacity: 0.5, cursor:'not-allowed', fontStyle:'italic' }}
          />
        </Field>
      </div>
      <Field label="Observații">
        <textarea
          value={form.observatii}
          onChange={e => setForm({...form, observatii: e.target.value})}
          rows={3}
          placeholder="ex: completare segment km 0+936 — 1+177 + 2 curbe CIC..."
          style={{...S.input, resize:'vertical', fontFamily:'inherit'}}
        />
      </Field>
      <div style={{ display:'flex', gap: 8, justifyContent:'flex-end', marginTop: 20 }}>
        <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
        <button style={S.btnP} onClick={save} disabled={saving}>
          {saving ? 'Salvez...' : 'Crează pachet'}
        </button>
      </div>
      <div style={{ marginTop: 16, padding: '10px 12px', background: G.purpleDim, borderRadius: 8, fontSize: 12, color: G.muted }}>
        ℹ După creare se deschide automat editorul. Adaugă rândurile din toolbar sau așteaptă Faza B pentru import Excel.
      </div>
    </ModalShell>
  )
}

// ===========================================================================
// UTILITARE UI
// ===========================================================================

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display:'block', fontSize: 11, color: G.muted, fontWeight: 600, textTransform:'uppercase', letterSpacing:'.3px', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function ModalShell({ onClose, children, maxWidth = 720 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset: 0, background:'rgba(0,0,0,.65)',
        display:'flex', alignItems:'center', justifyContent:'center',
        padding: 20, zIndex: 9000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: G.card, borderRadius: 12, border: `1px solid ${G.border}`,
          padding: 24, maxWidth, width:'100%', maxHeight:'90vh', overflow:'auto',
          boxShadow:'0 20px 60px rgba(0,0,0,.6)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
