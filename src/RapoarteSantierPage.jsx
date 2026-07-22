// ═══════════════════════════════════════════════════════════════════════════
// RapoarteSantierPage.jsx — Faza 2 modul Rapoarte Șantier (21.07.2026)
// Dashboard central pentru rapoartele zilnice trimise de manageri din app-ul /m.
//   - Listă filtrabilă (șantier + interval de zile) a tuturor rapoartelor
//   - Istoric cap-coadă per șantier (timeline)
//   - Sumar „azi: cine a raportat / cine lipsește"
//   - Modal detaliu: personal, utilaje, texte, poze (signed URL)
// Acces: owner + contabilitate → toate șantierele; manager_santier/sef_echipa
//   → doar șantierele lor (profile_sites). Zero scurgere de date.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { exportRapoarteExcel, exportRapoartePDF } from './rapoarteExport.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF', orange: '#F0883E',
  logistica: '#E3B341',
}
const BUCKET = 'rapoarte-zilnice'
const iso = (d) => d.toISOString().slice(0, 10)
const azi = () => iso(new Date())
const zileInUrma = (n) => iso(new Date(Date.now() - n * 86400000))
const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'
const fmtScurt = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' }) : '—'

const PERSONAL_CAT = [
  { key: 'sudori', label: '🔥 Sudori' },
  { key: 'lacatusi', label: '🔧 Lăcătuși' },
  { key: 'operatori', label: '🚜 Operatori' },
  { key: 'soferi', label: '🚛 Șoferi' },
  { key: 'necalificati', label: '👷 Necalificați' },
  { key: 'tesa', label: '👔 TESA' },
  { key: 'altii', label: '👤 Alții' },
]
const tipIcon = (tip) => /utilaj/i.test(tip || '') ? '🚜' : (tip ? '🚗' : '🔧')

const inputStyle = { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 8, padding: '8px 11px', fontFamily: 'inherit', fontSize: 14, outline: 'none' }

export default function RapoarteSantierPage() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [sites, setSites] = useState([])          // șantierele accesibile
  const [allSites, setAllSites] = useState([])    // toate active (pt. sumar „cine lipsește")
  const [loadingInit, setLoadingInit] = useState(true)

  const [tab, setTab] = useState('lista')          // lista | istoric
  const [filtruSite, setFiltruSite] = useState('') // '' = toate
  const [from, setFrom] = useState(zileInUrma(14))
  const [to, setTo] = useState(azi())
  const [rapoarte, setRapoarte] = useState([])
  const [loading, setLoading] = useState(false)
  const [detaliu, setDetaliu] = useState(null)     // raport deschis în modal
  const [istoricSite, setIstoricSite] = useState('') // șantier selectat în tab istoric
  const [exporting, setExporting] = useState(null) // 'excel' | 'pdf' | null
  const [exportErr, setExportErr] = useState(null)

  // ── init: profil + șantiere accesibile ──
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoadingInit(false); return }
      const { data: prof } = await supabase.from('profiles').select('id, name, role, is_owner').eq('id', user.id).maybeSingle()
      setProfile(prof || null)
      const { data: toate } = await supabase.from('sites').select('id, name, beneficiar_principal, active, raport_zilnic_necesar').order('name')
      const active = (toate || []).filter(s => s.active)
      setAllSites(active)
      const vedeTot = prof?.is_owner || prof?.role === 'contabilitate'
      if (vedeTot) {
        setSites(active)
      } else {
        const { data: ps } = await supabase.from('profile_sites').select('site_id, sites(id, name, beneficiar_principal, raport_zilnic_necesar)').eq('profile_id', user.id)
        setSites((ps || []).map(r => r.sites).filter(Boolean).sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      }
      setLoadingInit(false)
    })()
  }, [])

  const siteIds = useMemo(() => sites.map(s => s.id), [sites])
  const siteName = useCallback((id) => (allSites.find(s => s.id === id) || sites.find(s => s.id === id))?.name || `#${id}`, [allSites, sites])

  // ── încarcă rapoartele pe interval ──
  const loadRapoarte = useCallback(async () => {
    if (siteIds.length === 0) { setRapoarte([]); return }
    setLoading(true)
    let q = supabase.from('rapoarte_zilnice').select('*')
      .in('site_id', siteIds).gte('data', from).lte('data', to)
      .order('data', { ascending: false }).order('site_id')
    if (filtruSite) q = q.eq('site_id', Number(filtruSite))
    const { data } = await q
    setRapoarte(data || [])
    setLoading(false)
  }, [siteIds, from, to, filtruSite])

  useEffect(() => { if (!loadingInit) loadRapoarte() }, [loadingInit, loadRapoarte])

  // ── sumar azi ──
  const azo = azi()
  const rapoarteAzi = useMemo(() => new Set(rapoarte.filter(r => r.data === azo).map(r => r.site_id)), [rapoarte, azo])
  // „lipsă azi" = doar șantierele care necesită raport (exclude birou/parc auto)
  const santiereFaraRaportAzi = useMemo(() => sites.filter(s => s.raport_zilnic_necesar !== false && !rapoarteAzi.has(s.id)), [sites, rapoarteAzi])

  // ── grupare pt. istoric ──
  const istoricRapoarte = useMemo(() => {
    if (!istoricSite) return []
    return rapoarte.filter(r => r.site_id === Number(istoricSite)).sort((a, b) => a.data.localeCompare(b.data))
  }, [rapoarte, istoricSite])

  // ── export (Faza 4) ──
  const siteSelectatId = tab === 'istoric' ? (istoricSite ? Number(istoricSite) : null) : (filtruSite ? Number(filtruSite) : null)
  const listaExport = tab === 'istoric' ? istoricRapoarte : rapoarte
  const titluExport = siteSelectatId ? siteName(siteSelectatId) : 'Toate șantierele'

  const doExportExcel = useCallback(async () => {
    if (!listaExport.length) { setExportErr('Nimic de exportat în intervalul selectat.'); return }
    setExporting('excel'); setExportErr(null)
    try {
      await exportRapoarteExcel({ list: listaExport, siteNameOf: siteName, titluSite: titluExport, from, to })
    } catch (e) { setExportErr('Eroare export Excel: ' + (e?.message || e)) } finally { setExporting(null) }
  }, [listaExport, siteName, titluExport, from, to])

  const doExportPDF = useCallback(async () => {
    if (!siteSelectatId) { setExportErr('Pentru PDF sumar alege un singur șantier (din filtru sau tab-ul Istoric).'); return }
    const list = rapoarte.filter(r => r.site_id === siteSelectatId)
    if (!list.length) { setExportErr('Niciun raport pentru acest șantier în interval.'); return }
    setExporting('pdf'); setExportErr(null)
    try {
      await exportRapoartePDF({ list, titluSite: siteName(siteSelectatId), from, to })
    } catch (e) { setExportErr('Eroare export PDF: ' + (e?.message || e)) } finally { setExporting(null) }
  }, [siteSelectatId, rapoarte, siteName, from, to])

  if (loadingInit) return <Shell nav={nav}><div style={{ color: G.dim, textAlign: 'center', padding: 80 }}>Se încarcă…</div></Shell>

  if (sites.length === 0) return (
    <Shell nav={nav}>
      <div style={{ textAlign: 'center', padding: 60, color: G.muted }}>
        Nu ai șantiere alocate. Rapoartele de șantier apar aici după ce ți se alocă lucrări sau ești owner/contabilitate.
      </div>
    </Shell>
  )

  return (
    <Shell nav={nav}>
      {/* header + sumar azi */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: G.text }}>📋 Rapoarte Șantier</div>
          <div style={{ fontSize: 13, color: G.muted, marginTop: 3 }}>Rapoartele zilnice trimise de manageri din aplicația de teren</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <MiniStat label="Șantiere" val={sites.length} color={G.blue} />
          <MiniStat label="Rapoarte azi" val={rapoarteAzi.size} color={G.green} />
          <MiniStat label="Lipsă azi" val={santiereFaraRaportAzi.length} color={santiereFaraRaportAzi.length ? G.red : G.dim} />
        </div>
      </div>

      {/* alertă cine n-a raportat azi */}
      {santiereFaraRaportAzi.length > 0 && (
        <div style={{ background: G.red + '14', border: `1px solid ${G.red}33`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
          <span style={{ color: G.red, fontWeight: 700 }}>⚠️ Fără raport azi ({santiereFaraRaportAzi.length}):</span>{' '}
          <span style={{ color: G.muted }}>{santiereFaraRaportAzi.map(s => s.name).join(' · ')}</span>
        </div>
      )}

      {/* taburi */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TabBtn active={tab === 'lista'} onClick={() => setTab('lista')}>📋 Toate rapoartele</TabBtn>
        <TabBtn active={tab === 'istoric'} onClick={() => setTab('istoric')}>📈 Istoric pe șantier</TabBtn>
      </div>

      {/* filtre */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        {tab === 'lista' && (
          <select value={filtruSite} onChange={e => setFiltruSite(e.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
            <option value="">Toate șantierele ({sites.length})</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {tab === 'istoric' && (
          <select value={istoricSite} onChange={e => setIstoricSite(e.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
            <option value="">— alege șantierul —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: G.muted, fontSize: 13 }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
          <span>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[{ l: 'Azi', n: 0 }, { l: '7 zile', n: 7 }, { l: '30 zile', n: 30 }, { l: '90 zile', n: 90 }].map(p => (
            <button key={p.l} onClick={() => { setFrom(zileInUrma(p.n)); setTo(azi()) }} style={{
              background: from === zileInUrma(p.n) && to === azi() ? G.blue + '22' : G.surface, color: from === zileInUrma(p.n) && to === azi() ? G.blue : G.muted,
              border: `1px solid ${G.border}`, borderRadius: 7, padding: '7px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>{p.l}</button>
          ))}
        </div>
        {/* export */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button onClick={doExportExcel} disabled={!!exporting} title="Exportă rapoartele filtrate în Excel" style={{
            background: G.green + '18', color: G.green, border: `1px solid ${G.green}44`, borderRadius: 8, padding: '8px 13px',
            fontSize: 13, fontWeight: 700, cursor: exporting ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: exporting ? .6 : 1,
          }}>{exporting === 'excel' ? '…' : '⬇ Excel'}</button>
          <button onClick={doExportPDF} disabled={!!exporting} title="PDF sumar pentru un singur șantier" style={{
            background: G.red + '18', color: G.red, border: `1px solid ${G.red}44`, borderRadius: 8, padding: '8px 13px',
            fontSize: 13, fontWeight: 700, cursor: exporting ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: exporting ? .6 : 1,
          }}>{exporting === 'pdf' ? '…' : '⬇ PDF sumar'}</button>
        </div>
      </div>

      {exportErr && (
        <div style={{ background: G.red + '14', border: `1px solid ${G.red}33`, borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 13, color: G.red }}>
          {exportErr} <span onClick={() => setExportErr(null)} style={{ cursor: 'pointer', marginLeft: 8, opacity: .7 }}>✕</span>
        </div>
      )}

      {/* conținut */}
      {loading ? (
        <div style={{ color: G.dim, textAlign: 'center', padding: 50 }}>Se încarcă rapoartele…</div>
      ) : tab === 'lista' ? (
        <ListaRapoarte rapoarte={rapoarte} siteName={siteName} onOpen={setDetaliu} />
      ) : (
        <IstoricSantier istoricSite={istoricSite} rapoarte={istoricRapoarte} siteName={siteName} onOpen={setDetaliu} />
      )}

      {detaliu && <ModalDetaliu raport={detaliu} siteName={siteName} onClose={() => setDetaliu(null)} />}
    </Shell>
  )
}

// ── Listă rapoarte ──
function ListaRapoarte({ rapoarte, siteName, onOpen }) {
  if (rapoarte.length === 0) return <Empty text="Niciun raport în intervalul selectat." />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rapoarte.map(r => <CardRaport key={r.id} r={r} siteName={siteName} onOpen={onOpen} showSite />)}
    </div>
  )
}

// ── Istoric per șantier (timeline) ──
function IstoricSantier({ istoricSite, rapoarte, siteName, onOpen }) {
  if (!istoricSite) return <Empty text="Alege un șantier ca să vezi istoricul cap-coadă." />
  if (rapoarte.length === 0) return <Empty text="Niciun raport pentru acest șantier în interval." />
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: G.text, marginBottom: 12 }}>
        {siteName(Number(istoricSite))} · {rapoarte.length} {rapoarte.length === 1 ? 'raport' : 'rapoarte'}
        <span style={{ color: G.dim, fontWeight: 400, marginLeft: 8 }}>{fmtScurt(rapoarte[0].data)} → {fmtScurt(rapoarte[rapoarte.length - 1].data)}</span>
      </div>
      <div style={{ position: 'relative', paddingLeft: 20 }}>
        <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 2, background: G.border2 }} />
        {[...rapoarte].reverse().map(r => (
          <div key={r.id} style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ position: 'absolute', left: -18, top: 16, width: 10, height: 10, borderRadius: '50%', background: G.logistica, border: `2px solid ${G.bg}` }} />
            <CardRaport r={r} siteName={siteName} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Card raport (rând compact) ──
function CardRaport({ r, siteName, onOpen, showSite }) {
  const pers = r.personal_snapshot || {}
  const utj = Array.isArray(r.utilaje_snapshot) ? r.utilaje_snapshot : []
  const nefunc = utj.filter(u => u.stare === 'nefunctional').length
  const nrPoze = (r.poze || []).length
  return (
    <div onClick={() => onOpen(r)} style={{
      background: G.surface, border: `1px solid ${G.border}`, borderRadius: 11, padding: '13px 15px', cursor: 'pointer', transition: 'border-color .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = G.border2}
      onMouseLeave={e => e.currentTarget.style.borderColor = G.border}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: G.logistica, whiteSpace: 'nowrap' }}>{fmtData(r.data)}</span>
          {showSite && <span style={{ fontSize: 14, fontWeight: 700, color: G.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{siteName(r.site_id)}</span>}
          {r.sef_santier && <span style={{ fontSize: 12, color: G.dim, whiteSpace: 'nowrap' }}>· {r.sef_santier}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Chip icon="👷" val={pers.total || 0} color={G.green} />
          <Chip icon="🚜" val={utj.length} color={G.blue} warn={nefunc > 0 ? nefunc : null} />
          {nrPoze > 0 && <Chip icon="📷" val={nrPoze} color={G.purple} />}
        </div>
      </div>
      {r.lucrari_efectuate && (
        <div style={{ marginTop: 8, fontSize: 13, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {r.lucrari_efectuate}
        </div>
      )}
      {r.probleme && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: G.orange, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ⚠️ {r.probleme}
        </div>
      )}
    </div>
  )
}

// ── Modal detaliu ──
function ModalDetaliu({ raport, siteName, onClose }) {
  const [pozeUrls, setPozeUrls] = useState([])
  const [zoom, setZoom] = useState(null)
  useEffect(() => {
    (async () => {
      const paths = raport.poze || []
      if (paths.length === 0) { setPozeUrls([]); return }
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      setPozeUrls((data || []).map(d => d.signedUrl).filter(Boolean))
    })()
  }, [raport])

  const pers = raport.personal_snapshot || {}
  const utj = Array.isArray(raport.utilaje_snapshot) ? raport.utilaje_snapshot : []

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 16, maxWidth: 720, width: '100%', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>{siteName(raport.site_id)}</div>
            <div style={{ fontSize: 13, color: G.muted, marginTop: 3 }}>{fmtData(raport.data)}{raport.sef_santier ? ` · ${raport.sef_santier}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: G.bg, border: `1px solid ${G.border}`, color: G.text, borderRadius: 9, width: 34, height: 34, fontSize: 17, cursor: 'pointer' }}>×</button>
        </div>

        {/* personal */}
        <Bloc titlu="👷 Personal">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PERSONAL_CAT.filter(c => (pers[c.key] || 0) > 0).map(c => (
              <span key={c.key} style={{ background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, padding: '5px 10px', fontSize: 13, color: G.text }}>
                {c.label}: <strong style={{ color: G.green }}>{pers[c.key]}</strong>
              </span>
            ))}
            <span style={{ background: G.green + '18', borderRadius: 8, padding: '5px 10px', fontSize: 13, color: G.green, fontWeight: 700 }}>Total: {pers.total || 0}</span>
          </div>
        </Bloc>

        {/* utilaje + mașini */}
        {utj.length > 0 && (
          <Bloc titlu="🚜 Utilaje și mașini pe șantier">
            <div style={{ display: 'grid', gap: 6 }}>
              {utj.map((u, i) => {
                const ctx = /utilaj/i.test(u.tip || '') ? (u.ore != null ? `${Number(u.ore).toLocaleString('ro-RO')} ore` : '') : (u.km != null ? `${Number(u.km).toLocaleString('ro-RO')} km` : '')
                return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, padding: '7px 11px' }}>
                  <span style={{ fontSize: 13, color: G.text, minWidth: 0 }}>{tipIcon(u.tip)} {u.nume || u.cod || '—'}<span style={{ color: G.dim }}>{[u.cod && u.nume ? u.cod : '', ctx].filter(Boolean).length ? ' · ' + [u.cod && u.nume ? u.cod : '', ctx].filter(Boolean).join(' · ') : ''}</span></span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: u.alimentat ? G.blue : G.dim }}>{u.alimentat ? '⛽ alimentat' : '⛽ —'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: u.stare === 'nefunctional' ? G.red : G.green }}>
                      {u.stare === 'nefunctional' ? `✕ ${u.motiv || 'nefuncțional'}` : '✓ funcțional'}
                    </span>
                  </span>
                </div>
              )})}
            </div>
          </Bloc>
        )}

        {raport.lucrari_efectuate && <Bloc titlu="🔧 Lucrări efectuate"><Text v={raport.lucrari_efectuate} /></Bloc>}
        {raport.masini && <Bloc titlu="🚗 Mașini"><Text v={raport.masini} /></Bloc>}
        {raport.probleme && <Bloc titlu="⚠️ Probleme / Observații"><Text v={raport.probleme} color={G.orange} /></Bloc>}
        {raport.plan_maine && <Bloc titlu="📅 Plan pentru mâine"><Text v={raport.plan_maine} /></Bloc>}

        {/* poze */}
        {pozeUrls.length > 0 && (
          <Bloc titlu={`📷 Poze (${pozeUrls.length})`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {pozeUrls.map((u, i) => (
                <img key={i} src={u} alt="" onClick={() => setZoom(u)} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 9, border: `1px solid ${G.border2}`, cursor: 'zoom-in' }} />
              ))}
            </div>
          </Bloc>
        )}
      </div>

      {zoom && (
        <div onClick={(e) => { e.stopPropagation(); setZoom(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.9)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 10 }} />
        </div>
      )}
    </div>
  )
}

// ── Helpers UI ──
function Shell({ children, nav }) {
  return (
    <div style={{ minHeight: '100vh', background: G.bg, color: G.text, fontFamily: "'Syne','Barlow',sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 60px' }}>
        <button onClick={() => nav('/')} style={{ background: 'transparent', border: 'none', color: G.dim, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>← Acasă</button>
        {children}
      </div>
    </div>
  )
}
function MiniStat({ label, val, color }) {
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: '8px 14px', textAlign: 'center', minWidth: 74 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'monospace' }}>{val}</div>
      <div style={{ fontSize: 10.5, color: G.muted, textTransform: 'uppercase', letterSpacing: .5 }}>{label}</div>
    </div>
  )
}
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? G.logistica + '1c' : G.surface, color: active ? G.logistica : G.muted,
      border: `1px solid ${active ? G.logistica + '55' : G.border}`, borderRadius: 9, padding: '9px 15px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  )
}
function Chip({ icon, val, color, warn }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 20, padding: '3px 9px', fontSize: 12, color: G.text, whiteSpace: 'nowrap' }}>
      {icon} <strong style={{ color }}>{val}</strong>
      {warn != null && <span style={{ color: G.red, fontWeight: 700 }}>({warn}✕)</span>}
    </span>
  )
}
function Bloc({ titlu, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: G.muted, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 8 }}>{titlu}</div>
      {children}
    </div>
  )
}
function Text({ v, color }) {
  return <div style={{ fontSize: 14, color: color || G.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{v}</div>
}
function Empty({ text }) {
  return <div style={{ color: G.dim, textAlign: 'center', padding: 50, fontSize: 14 }}>{text}</div>
}
