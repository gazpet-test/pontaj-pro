// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab Documente Flotă (Etapa 1: read-only)
// ════════════════════════════════════════════════════════════════════════════
// Sursa adevărului: logistica_active (utilaje) + logistica_documente (docs)
// View: v_logistica_alerte (calculează zile_ramase + status la nivel BD)
// Bucket Storage pentru PDF-uri (Etapa 2): documente-flota
//
// Etapa 1 oferă: KPI sus, 3 filtre (tip, stare, search), tabel paginat,
// buton view PDF când există pdf_url. Edit/Add/Upload urmează în Etapa 2.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

// ─── Theme (sincron cu Logistica.jsx) ───────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const PAGE_SIZE = 50

// 4 stări corespunzătoare view-ului v_logistica_alerte (expirat | expira_30z | expira_90z | ok)
const STARI = [
  { key:'expirat',    label:'Expirat',     color:G.red,    bg:G.redDim    },
  { key:'expira_30z', label:'Expiră 30z',  color:G.orange, bg:'#3A2010'   },
  { key:'expira_90z', label:'Expiră 90z',  color:G.yellow, bg:G.yellowDim },
  { key:'ok',         label:'În regulă',   color:G.green,  bg:G.greenDim  },
]

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

// Calc status la nivel de doc (același prag ca v_logistica_alerte: <0 expirat, ≤30 30z, ≤90 90z, rest ok)
const computeStatus = (zile) => {
  if (zile == null) return 'ok'
  if (zile < 0)   return 'expirat'
  if (zile <= 30) return 'expira_30z'
  if (zile <= 90) return 'expira_90z'
  return 'ok'
}

// Format compact zile rămase: "Azi" / "5z" / "−3z" / "93z"
const fmtZile = (zile) => {
  if (zile == null) return '—'
  if (zile === 0)   return 'Azi'
  if (zile < 0)     return `−${Math.abs(zile)}z`
  return `${zile}z`
}

const daysUntilToday = (dateStr) => {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

// ─── Sub-componente reutilizabile ───────────────────────────────────────────

function KPICard({ icon, label, value, color, bg }) {
  return (
    <div style={{...S.card, padding:'14px 18px', background: bg || G.surface, borderColor: color ? color+'33' : G.border}}>
      <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color: color || G.muted, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:8}}>
        <span style={{fontSize:13}}>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{fontSize:28, fontWeight:800, color: color || G.text, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{value}</div>
    </div>
  )
}

function StareBadge({ stare }) {
  const cfg = STARI.find(s => s.key === stare) || { label:stare, color:G.dim }
  return (
    <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background: cfg.color+'22', color: cfg.color, whiteSpace:'nowrap'}}>
      {cfg.label}
    </span>
  )
}

// ─── Componenta principală ──────────────────────────────────────────────────

export default function DocumenteFlotaPage({ active, accessLevel, profile, showToast }) {
  // Note: prop `active` vine din LogisticaPage (lista de logistica_active deja încărcată)
  // O folosim pentru lookup rapid pe id → utilaj, evităm încă un fetch.
  
  const [docs, setDocs]       = useState([])
  const [tipuri, setTipuri]   = useState([])
  const [load, setLoad]       = useState(true)
  const [openingPdfId, setOpeningPdfId] = useState(null)

  const [search, setSearch]   = useState('')
  const [tipF, setTipF]       = useState('Toate')
  const [stareF, setStareF]   = useState('Toate')
  const [page, setPage]       = useState(1)

  const canEdit = accessLevel === 'admin' || accessLevel === 'editor'

  // Map id → utilaj (pentru join în memorie cu props.active)
  const activMap = useMemo(() => {
    const m = {}
    for (const a of (active || [])) m[a.id] = a
    return m
  }, [active])

  const loadAll = useCallback(async () => {
    setLoad(true)
    const [docsRes, tipuriRes] = await Promise.all([
      supabase.from('logistica_documente')
        .select('id, entitate_id, active_id, tip_id, numar_document, data_emitere, data_expirare, emitent, cost, pdf_url, pdf_locatie, observatii, created_at')
        .order('data_expirare', { ascending:true, nullsFirst:false }),
      supabase.from('logistica_tipuri_documente')
        .select('id, nume, descriere, perioada_default_zile, activ')
        .eq('activ', true)
        .order('nume'),
    ])
    if (docsRes.error)   showToast(`Eroare la încărcare documente: ${docsRes.error.message}`, 'error')
    if (tipuriRes.error) showToast(`Eroare la încărcare tipuri: ${tipuriRes.error.message}`, 'error')
    setDocs(docsRes.data || [])
    setTipuri(tipuriRes.data || [])
    setLoad(false)
  }, [showToast])

  useEffect(() => { loadAll() }, [loadAll])

  // Reset paginare când se schimbă filtrele
  useEffect(() => { setPage(1) }, [search, tipF, stareF])

  // Enrich: adaug utilaj + zile_ramase + status (computate local pentru a fi consistente cu UI)
  const enriched = useMemo(() => {
    return docs.map(d => {
      const activId = d.entitate_id ?? d.active_id
      const u = activMap[activId] || null
      const zile = daysUntilToday(d.data_expirare)
      const status = computeStatus(zile)
      const tip = tipuri.find(t => t.id === d.tip_id)
      return { ...d, _utilaj:u, _zile:zile, _status:status, _tipNume: tip?.nume || `tip #${d.tip_id}` }
    })
  }, [docs, activMap, tipuri])

  // KPI-uri din enriched (după computeStatus, ca să fie 100% consistent cu badge-urile din tabel)
  const kpi = useMemo(() => {
    const k = { total: enriched.length, expirat:0, expira_30z:0, expira_90z:0, ok:0 }
    for (const d of enriched) k[d._status]++
    return k
  }, [enriched])

  // Filtrare client-side (227 docs sunt OK în memorie)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter(d => {
      if (tipF !== 'Toate'   && d._tipNume !== tipF) return false
      if (stareF !== 'Toate' && d._status !== stareF) return false
      if (q) {
        const u = d._utilaj
        const hay = [
          u?.marca, u?.model, u?.nr_inmatriculare, u?.cod_intern, u?.nr_inventar,
          d.numar_document, d._tipNume, d.emitent,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, search, tipF, stareF])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  // ─── Acțiuni ─────────────────────────────────────────────────────────────
  const openPdf = async (doc) => {
    if (!doc.pdf_url) { showToast('Acest document nu are PDF uploadat', 'warn'); return }
    setOpeningPdfId(doc.id)
    try {
      // pdf_url se interpretează ca path în bucket-ul documente-flota
      const { data, error } = await supabase.storage.from('documente-flota').createSignedUrl(doc.pdf_url, 60)
      if (error) throw error
      window.open(data.signedUrl, '_blank')
    } catch (e) {
      showToast('Eroare preview PDF: ' + (e.message || e), 'error')
    } finally {
      setOpeningPdfId(null)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  if (load) {
    return (
      <div style={{...S.card, padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
        ⏳ Se încarcă documentele…
      </div>
    )
  }

  return (
    <div>
      {/* KPI grid */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16}}>
        <KPICard icon="📎" label="Total documente" value={kpi.total} />
        <KPICard icon="🚨" label="Expirate"        value={kpi.expirat}    color={G.red}    bg={G.redDim+'66'} />
        <KPICard icon="⏰" label="Expiră ≤ 30z"    value={kpi.expira_30z} color={G.orange} bg="#3A201066" />
        <KPICard icon="🕒" label="Expiră ≤ 90z"    value={kpi.expira_90z} color={G.yellow} bg={G.yellowDim+'66'} />
      </div>

      {/* Filter bar */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1.6fr auto', gap:10, marginBottom:14}}>
        <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate tipurile</option>
          {tipuri.map(t => <option key={t.id} value={t.nume}>{t.nume}</option>)}
        </select>
        <select value={stareF} onChange={e => setStareF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate stările</option>
          <option value="expirat">Doar expirate</option>
          <option value="expira_30z">Expiră în 30 zile</option>
          <option value="expira_90z">Expiră în 90 zile</option>
          <option value="ok">În regulă</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔎 Marcă, plăcuță, cod intern, nr document…"
          style={{...S.input, padding:'9px 12px'}}
        />
        <button
          disabled
          title="Disponibil în Etapa 2"
          style={{...S.btnS, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, opacity:.55, cursor:'not-allowed', borderStyle:'dashed'}}
        >
          ➕ Adaugă document
          <span style={{background:G.yellow+'22', color:G.yellow, fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:4, letterSpacing:'.3px'}}>ETAPA 2</span>
        </button>
      </div>

      {/* Tabel */}
      <div style={{...S.card, overflow:'hidden'}}>
        {/* Header */}
        <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 110px 50px', gap:10, padding:'12px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px'}}>
          <div>Utilaj</div>
          <div>Tip doc</div>
          <div>Expirare</div>
          <div>Zile</div>
          <div>Stare</div>
          <div></div>
        </div>

        {/* Rows */}
        {paginated.length === 0 ? (
          <div style={{padding:50, textAlign:'center', color:G.muted, fontSize:13}}>
            {filtered.length === 0 && enriched.length > 0
              ? '🔍 Niciun document nu se potrivește cu filtrele aplicate.'
              : '📭 Nu există documente.'}
          </div>
        ) : paginated.map(d => {
          const u = d._utilaj
          const zileColor = d._status === 'expirat' ? G.red
                          : d._status === 'expira_30z' ? G.orange
                          : d._status === 'expira_90z' ? G.yellow
                          : G.muted
          const hasPdf = !!d.pdf_url
          return (
            <div key={d.id} style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.1fr) 100px 70px 110px 50px', gap:10, padding:'11px 16px', alignItems:'center', borderBottom:`1px solid ${G.border}`, fontSize:13}}>
              {/* Utilaj */}
              <div style={{minWidth:0}}>
                {u ? (
                  <>
                    <div style={{fontWeight:600, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                      {u.marca} {u.model}
                    </div>
                    <div style={{display:'flex', gap:8, fontSize:11, marginTop:2, alignItems:'center'}}>
                      {u.nr_inmatriculare && <span style={{color:G.blue, fontFamily:'monospace'}}>{u.nr_inmatriculare}</span>}
                      {u.cod_intern && <span style={{color:G.logistica, fontFamily:'monospace', fontWeight:700}}>{u.cod_intern}</span>}
                    </div>
                  </>
                ) : (
                  <span style={{color:G.dim, fontStyle:'italic'}}>utilaj #{d.entitate_id ?? d.active_id} (lipsă)</span>
                )}
              </div>
              {/* Tip doc */}
              <div style={{color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d._tipNume}</div>
              {/* Data expirare */}
              <div style={{color:G.muted, fontVariantNumeric:'tabular-nums', fontSize:12}}>{fmtDate(d.data_expirare)}</div>
              {/* Zile */}
              <div style={{color: zileColor, fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{fmtZile(d._zile)}</div>
              {/* Stare badge */}
              <div><StareBadge stare={d._status} /></div>
              {/* Acțiuni: doar view PDF în Etapa 1 */}
              <div>
                <button
                  onClick={() => hasPdf && openPdf(d)}
                  disabled={!hasPdf || openingPdfId === d.id}
                  title={hasPdf ? 'Deschide PDF în tab nou' : 'Fără PDF uploadat'}
                  style={{
                    width:32, height:32, borderRadius:6,
                    background: hasPdf ? G.bg : 'transparent',
                    border:`1px solid ${hasPdf ? G.border2 : G.border}`,
                    color: hasPdf ? G.blue : G.dim,
                    cursor: hasPdf ? 'pointer' : 'not-allowed',
                    opacity: hasPdf ? 1 : .4,
                    fontSize:14,
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}
                >
                  {openingPdfId === d.id ? '⏳' : (hasPdf ? '👁' : '∅')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer cu paginare */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, fontSize:12, color:G.muted}}>
        <div>
          Afișate {paginated.length > 0 ? ((safePage-1)*PAGE_SIZE + 1) : 0}–{(safePage-1)*PAGE_SIZE + paginated.length}
          {' '}din {filtered.length}
          {filtered.length !== enriched.length && <span style={{color:G.dim}}> (total {enriched.length})</span>}
        </div>
        {totalPages > 1 && (
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={safePage <= 1} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage <= 1 ? .4 : 1, cursor: safePage <= 1 ? 'not-allowed' : 'pointer'}}>← Prev</button>
            <span style={{padding:'0 8px', fontVariantNumeric:'tabular-nums'}}>{safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={safePage >= totalPages} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage >= totalPages ? .4 : 1, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer'}}>Next →</button>
          </div>
        )}
      </div>

      {/* Notă subtilă pentru utilizator când vede multe docs fără PDF */}
      {kpi.total > 0 && docs.filter(d => d.pdf_url).length === 0 && (
        <div style={{marginTop:14, padding:'10px 14px', background:G.yellowDim+'33', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.yellow}}>
          ℹ️ Niciun document nu are PDF asociat încă. Upload-ul de PDF-uri va fi disponibil în Etapa 2.
        </div>
      )}
    </div>
  )
}
