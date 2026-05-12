// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Tab Personal (read-only din modulul HR)
// ════════════════════════════════════════════════════════════════════════════
// Etapa 4a: vizualizare autorizații personal relevante pentru logistică
// - Sursa: v_hr_autorizatii_status (view BD, gata calculat)
// - Filtru scope: iscir + transport + profesional restrâns
//   (OPERATOR_UTILAJ, MECANIC_AUTO)
// - Bucket Storage: autorizatii (signed URL 60s)
// - READ-ONLY: editarea rămâne în modulul HR
// - Pure component: primește docs ca prop din DocumenteFlotaPage (single source)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

// ─── Theme (sincron cu DocumenteFlotaPage.jsx + AmcSection.jsx) ─────────────
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
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const PAGE_SIZE = 50
const BUCKET = 'autorizatii'

// Stările reale ale view-ului v_hr_autorizatii_status
// (valid / expira_60z / expira_30z / expirat / fara_data / fara_exp)
const STARI = [
  { key:'expirat',    label:'Expirat',         color:G.red,    bg:G.redDim    },
  { key:'expira_30z', label:'Expiră 30z',      color:G.orange, bg:'#3A2010'   },
  { key:'expira_60z', label:'Expiră 60z',      color:G.yellow, bg:'#3A3010'   },
  { key:'valid',      label:'Valid',           color:G.green,  bg:G.greenDim  },
  { key:'fara_data',  label:'Fără dată',       color:G.dim,    bg:G.bg        },
  { key:'fara_exp',   label:'Fără expirare',   color:G.blue,   bg:'#0E2540'   },
]

// Categorii relevante pentru logistică (badge colorat)
const CATEGORII = {
  iscir:       { label:'ISCIR',       color:G.orange },
  transport:   { label:'Transport',   color:G.blue   },
  profesional: { label:'Profesional', color:G.green  },
}

// Filtru categorie în UI (3 opțiuni + Toate)
const CATEGORII_FILTRU = [
  { key:'Toate',       label:'Toate categoriile' },
  { key:'iscir',       label:'ISCIR' },
  { key:'transport',   label:'Transport' },
  { key:'profesional', label:'Operatori utilaj + Mecanic' },
]

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

const fmtZile = (zile, status) => {
  if (status === 'fara_exp')  return '∞'
  if (status === 'fara_data') return '?'
  if (zile == null) return '—'
  if (zile === 0)   return 'Azi'
  if (zile < 0)     return `−${Math.abs(zile)}z`
  return `${zile}z`
}

async function openPdfFromBucket(pdfPath, showToast, setLoadingId, docId) {
  if (!pdfPath) { showToast('Acest document nu are PDF uploadat', 'warn'); return }
  if (setLoadingId) setLoadingId(docId)
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfPath, 60)
    if (error) throw error
    window.open(data.signedUrl, '_blank')
  } catch (e) {
    showToast('Eroare preview PDF: ' + (e.message || e), 'error')
  } finally {
    if (setLoadingId) setLoadingId(null)
  }
}

// ─── Sub-componente ─────────────────────────────────────────────────────────

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
  const cfg = STARI.find(s => s.key === stare) || { label:stare || '—', color:G.dim }
  return (
    <span style={{display:'inline-block', padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, letterSpacing:'.3px', background: cfg.color+'22', color: cfg.color, whiteSpace:'nowrap'}}>
      {cfg.label}
    </span>
  )
}

function CategorieBadge({ categorie }) {
  const cfg = CATEGORII[categorie] || { label:categorie || '—', color:G.dim }
  return (
    <span style={{display:'inline-block', padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:700, letterSpacing:'.4px', textTransform:'uppercase', background: cfg.color+'1F', color: cfg.color, whiteSpace:'nowrap'}}>
      {cfg.label}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECȚIUNEA PRINCIPALĂ — Tab Personal
// ════════════════════════════════════════════════════════════════════════════

export default function PersonalSection({ docs, loading, showToast }) {
  const [openingPdfId, setOpeningPdfId] = useState(null)
  const [search, setSearch]   = useState('')
  const [catF, setCatF]       = useState('Toate')
  const [tipF, setTipF]       = useState('Toate')
  const [stareF, setStareF]   = useState('Toate')
  const [page, setPage]       = useState(1)

  useEffect(() => { setPage(1) }, [search, catF, tipF, stareF])

  // Tipuri unice din docs (pentru dropdown filtru) — dinamic
  const tipuriDisponibile = useMemo(() => {
    const set = new Set()
    for (const d of docs) {
      if (d.tip_denumire) set.add(d.tip_denumire)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ro'))
  }, [docs])

  // KPI: total + expirate + expira_30z + fara_data
  const kpi = useMemo(() => {
    const k = { total: docs.length, expirat:0, expira_30z:0, fara_data:0 }
    for (const d of docs) {
      if (d.status === 'expirat')    k.expirat++
      if (d.status === 'expira_30z') k.expira_30z++
      if (d.status === 'fara_data')  k.fara_data++
    }
    return k
  }, [docs])

  // Filtrare client-side
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter(d => {
      if (catF   !== 'Toate' && d.tip_categorie !== catF) return false
      if (tipF   !== 'Toate' && d.tip_denumire  !== tipF) return false
      if (stareF !== 'Toate' && d.status        !== stareF) return false
      if (q) {
        const hay = [
          d.employee_name, d.functie, d.departament_hr,
          d.tip_denumire, d.numar_autorizatie, d.emitent,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [docs, search, catF, tipF, stareF])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, safePage])

  if (loading) {
    return (
      <div style={{...S.card, padding:60, textAlign:'center', color:G.muted, fontSize:14}}>
        ⏳ Se încarcă autorizațiile…
      </div>
    )
  }

  const handleRowClick = () => {
    showToast('Pentru editare contactează departamentul HR', 'info')
  }

  return (
    <div>
      {/* KPI 4 carduri */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16}}>
        <KPICard icon="📋" label="Total autorizații" value={kpi.total} />
        <KPICard icon="🚨" label="Expirate"          value={kpi.expirat}    color={G.red}    bg={G.redDim+'66'} />
        <KPICard icon="⏰" label="Expiră ≤ 30z"      value={kpi.expira_30z} color={G.orange} bg="#3A201066" />
        <KPICard icon="❓" label="Fără dată"          value={kpi.fara_data}  color={G.dim} />
      </div>

      {/* Banner info read-only */}
      <div style={{...S.card, padding:'10px 14px', marginBottom:14, background:G.blue+'10', borderColor:G.blue+'33', display:'flex', alignItems:'center', gap:10, fontSize:12.5, color:G.muted}}>
        <span style={{fontSize:16}}>ℹ️</span>
        <span>Vizualizare read-only. Pentru a adăuga sau edita autorizații, folosește modulul <strong style={{color:G.text}}>HR → Autorizații</strong>.</span>
      </div>

      {/* Filtre */}
      <div style={{display:'grid', gridTemplateColumns:'1.2fr 1fr 1fr 1.6fr', gap:10, marginBottom:14}}>
        <select value={catF} onChange={e => setCatF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          {CATEGORII_FILTRU.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={tipF} onChange={e => setTipF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate tipurile</option>
          {tipuriDisponibile.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={stareF} onChange={e => setStareF(e.target.value)} style={{...S.input, padding:'9px 12px', cursor:'pointer'}}>
          <option value="Toate">Toate stările</option>
          {STARI.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔎 Nume angajat, funcție, tip, departament…"
          style={{...S.input, padding:'9px 12px'}}
        />
      </div>

      {/* Tabel */}
      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.6fr) 120px 100px 70px 110px 50px', gap:10, padding:'12px 16px', background:G.bg, borderBottom:`1px solid ${G.border}`, fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:'.5px'}}>
          <div>Angajat</div>
          <div>Tip autorizație</div>
          <div>Categorie</div>
          <div>Expirare</div>
          <div>Zile</div>
          <div>Stare</div>
          <div></div>
        </div>

        {paginated.length === 0 ? (
          <div style={{padding:50, textAlign:'center', color:G.muted, fontSize:13}}>
            {filtered.length === 0 && docs.length > 0
              ? '🔍 Nicio autorizație nu se potrivește cu filtrele aplicate.'
              : '📭 Nu există autorizații în scope-ul logisticii.'}
          </div>
        ) : paginated.map(d => {
          const zileColor = d.status === 'expirat' ? G.red
                          : d.status === 'expira_30z' ? G.orange
                          : d.status === 'expira_60z' ? G.yellow
                          : d.status === 'fara_data' ? G.dim
                          : G.muted
          const hasPdf = !!d.fisier_path
          return (
            <div key={d.id}
              onClick={handleRowClick}
              style={{display:'grid', gridTemplateColumns:'minmax(0, 2fr) minmax(0, 1.6fr) 120px 100px 70px 110px 50px', gap:10, padding:'11px 16px', alignItems:'center', borderBottom:`1px solid ${G.border}`, fontSize:13, cursor:'pointer', transition:'background .12s'}}
              onMouseEnter={e => e.currentTarget.style.background = G.bg + '88'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {/* Angajat */}
              <div style={{minWidth:0}}>
                <div style={{fontWeight:600, color:G.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {d.employee_name || '—'}
                </div>
                <div style={{fontSize:11, color:G.dim, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {[d.functie, d.departament_hr].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>

              {/* Tip */}
              <div style={{minWidth:0}}>
                <div style={{whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', color:G.text}}>
                  {d.tip_denumire || '—'}
                </div>
                {d.numar_autorizatie && (
                  <div style={{fontSize:10.5, color:G.dim, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                    nr. {d.numar_autorizatie}
                  </div>
                )}
              </div>

              {/* Categorie */}
              <div><CategorieBadge categorie={d.tip_categorie} /></div>

              {/* Expirare */}
              <div style={{fontVariantNumeric:'tabular-nums', color: d.status === 'fara_exp' ? G.blue : (d.status === 'fara_data' ? G.dim : G.text), fontSize:12.5}}>
                {d.status === 'fara_exp'  ? 'Permanent'
                 : d.status === 'fara_data' ? '—'
                 : fmtDate(d.data_expirare)}
              </div>

              {/* Zile */}
              <div style={{fontVariantNumeric:'tabular-nums', color: zileColor, fontWeight:600, fontSize:12.5}}>
                {fmtZile(d.zile_pana_expirare, d.status)}
              </div>

              {/* Stare */}
              <div><StareBadge stare={d.status} /></div>

              {/* PDF */}
              <div style={{display:'flex', justifyContent:'center'}}>
                <button
                  onClick={(e) => { e.stopPropagation(); openPdfFromBucket(d.fisier_path, showToast, setOpeningPdfId, d.id) }}
                  disabled={!hasPdf}
                  title={hasPdf ? 'Deschide PDF' : 'Fără PDF uploadat'}
                  style={{
                    width:28, height:28, borderRadius:6,
                    background: hasPdf ? G.bg : 'transparent',
                    border:`1px solid ${hasPdf ? G.border2 : G.border}`,
                    color: hasPdf ? G.blue : G.dim,
                    cursor: hasPdf ? 'pointer' : 'not-allowed',
                    opacity: hasPdf ? 1 : .35, fontSize:12,
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

      {/* Paginare */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, fontSize:12, color:G.muted}}>
        <div>
          Afișate {paginated.length > 0 ? ((safePage-1)*PAGE_SIZE + 1) : 0}–{(safePage-1)*PAGE_SIZE + paginated.length}
          {' '}din {filtered.length}
          {filtered.length !== docs.length && <span style={{color:G.dim}}> (total {docs.length})</span>}
          <span style={{color:G.dim, marginLeft:10}}>· click pe rând = info HR</span>
        </div>
        {totalPages > 1 && (
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={safePage <= 1} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage <= 1 ? .4 : 1, cursor: safePage <= 1 ? 'not-allowed' : 'pointer'}}>← Prev</button>
            <span style={{padding:'0 8px', fontVariantNumeric:'tabular-nums'}}>{safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={safePage >= totalPages} style={{...S.btnS, padding:'5px 12px', fontSize:12, opacity: safePage >= totalPages ? .4 : 1, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer'}}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
