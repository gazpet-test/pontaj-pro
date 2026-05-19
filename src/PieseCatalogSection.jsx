// ════════════════════════════════════════════════════════════════════════════
// MODULUL LOGISTICĂ — Sub-secțiune Piese Catalog (din tab Service)
// ════════════════════════════════════════════════════════════════════════════
// Funcție: cauți un cod piesă (filtru, ulei, curea etc.) și vezi:
//   - dacă există în catalog (logistica_piese_catalog) → afișaz card cu detalii
//   - listă mașinile pe care s-a folosit (din logistica_piese_istoric)
//   - căutare pe denumire (FILTRU ULEI) → grupare după denumire + mașini care
//     l-au folosit chiar fără cod
// Sursa de date: 2 tabele BD (catalog + istoric) populat 18.05.2026
//   din 61 registre mentenanță XLSX + manual.
// Bonus: add cod nou (canEdit), grupare per categorie, stats sumar.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

// ─── Theme (sincron cu ServiceTab.jsx) ──────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const CATEGORII_PIESE = [
  'Filtru aer', 'Filtru ulei', 'Filtru combustibil', 'Filtru habitaclu',
  'Ulei motor', 'Curea distribuție', 'Curea accesorii', 'Pompă apă',
  'Frână', 'Suspensie', 'Anvelope', 'Baterie', 'Altele'
]

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const norm = (s) => (s || '').toString().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// ─── KPI Card mic (compact) ─────────────────────────────────────────────────
function KPIMic({ icon, label, value, color = G.blue, sub }) {
  return (
    <div style={{...S.card, padding:'12px 16px', minWidth:160, flex:1}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
        <span style={{fontSize:20}}>{icon}</span>
        <span style={{fontSize:11, color:G.muted, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5}}>{label}</span>
      </div>
      <div style={{fontSize:22, fontWeight:800, color}}>{value}</div>
      {sub && <div style={{fontSize:11, color:G.dim, marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ─── Modal: Adaugă cod nou în catalog ───────────────────────────────────────
function AddCodModal({ onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    cod: '', denumire: '', categorie: '', producator: '', observatii: ''
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.cod.trim() || !form.denumire.trim()) {
      showToast('Cod și denumire sunt obligatorii', 'error'); return
    }
    setSaving(true)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('logistica_piese_catalog').insert({
      cod: form.cod.trim(),
      denumire: form.denumire.trim(),
      categorie: form.categorie || null,
      producator: form.producator.trim() || null,
      observatii: form.observatii.trim() || null,
      created_by: u?.user?.id,
    })
    if (error) {
      showToast(error.code === '23505' ? `Codul "${form.cod}" există deja!` : `Eroare: ${error.message}`, 'error')
      setSaving(false); return
    }
    showToast(`✓ Cod "${form.cod}" adăugat în catalog`, 'success')
    setSaving(false)
    onSaved()
  }

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        ...S.card, padding:24, maxWidth:520, width:'100%',
      }}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18}}>
          <h3 style={{margin:0, fontSize:18, color:G.text}}>➕ Adaugă cod piesă nou</h3>
          <button onClick={onClose} style={{...S.btnS, padding:'4px 10px', fontSize:18}}>×</button>
        </div>

        <div style={{display:'grid', gap:12}}>
          <div>
            <label style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:4, display:'block'}}>COD PIESĂ *</label>
            <input style={S.input} value={form.cod} onChange={e => setForm({...form, cod:e.target.value.toUpperCase()})} placeholder="ex: MAC30130/2, CT1078K1..." autoFocus />
          </div>
          <div>
            <label style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:4, display:'block'}}>DENUMIRE *</label>
            <input style={S.input} value={form.denumire} onChange={e => setForm({...form, denumire:e.target.value})} placeholder="ex: FILTRU AER" />
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
            <div>
              <label style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:4, display:'block'}}>CATEGORIE</label>
              <select style={S.input} value={form.categorie} onChange={e => setForm({...form, categorie:e.target.value})}>
                <option value="">— alege —</option>
                {CATEGORII_PIESE.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:4, display:'block'}}>PRODUCĂTOR</label>
              <input style={S.input} value={form.producator} onChange={e => setForm({...form, producator:e.target.value})} placeholder="MANN, CONTITECH..." />
            </div>
          </div>
          <div>
            <label style={{fontSize:11, color:G.muted, fontWeight:600, marginBottom:4, display:'block'}}>OBSERVAȚII</label>
            <textarea style={{...S.input, minHeight:60, resize:'vertical'}} value={form.observatii} onChange={e => setForm({...form, observatii:e.target.value})} placeholder="ex: Compatibil cu modele Renault Megane 1.5 dCi..." />
          </div>
        </div>

        <div style={{display:'flex', gap:8, marginTop:18, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btnP, opacity: saving ? 0.5 : 1}}>
            {saving ? 'Se salvează…' : 'Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Card cu detalii cod găsit + listă mașini compatibile ───────────────────
function CodCard({ entry, expanded, onToggle, canEdit, onDelete }) {
  const { cod, denumire, categorie, producator, observatii, masini, sursa } = entry
  const nrMasini = masini.length
  const nrUtilizari = masini.reduce((s, m) => s + m.utilizari.length, 0)

  return (
    <div style={{
      ...S.card, padding:16,
      borderLeft: sursa === 'catalog' ? `3px solid ${G.green}` : `3px solid ${G.muted}`,
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, cursor:'pointer'}} onClick={onToggle}>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6, flexWrap:'wrap'}}>
            {cod ? (
              <span style={{
                background: G.green + '22', color: G.green, padding:'4px 10px',
                borderRadius:6, fontFamily:'ui-monospace, monospace', fontSize:14, fontWeight:700,
              }}>{cod}</span>
            ) : (
              <span style={{
                background: G.muted + '22', color: G.muted, padding:'4px 10px',
                borderRadius:6, fontSize:12, fontStyle:'italic',
              }}>fără cod (doar denumire)</span>
            )}
            <span style={{fontSize:15, color:G.text, fontWeight:600}}>{denumire}</span>
            {categorie && <span style={{fontSize:11, color:G.muted, background:G.bg, padding:'2px 8px', borderRadius:4}}>{categorie}</span>}
          </div>
          {producator && <div style={{fontSize:12, color:G.muted}}>Producător: <span style={{color:G.text}}>{producator}</span></div>}
        </div>
        <div style={{textAlign:'right', minWidth:130}}>
          <div style={{fontSize:11, color:G.muted, marginBottom:2}}>
            🚛 <strong style={{color:G.blue}}>{nrMasini}</strong> mașin{nrMasini === 1 ? 'ă' : 'i'}
          </div>
          <div style={{fontSize:11, color:G.muted}}>
            🔄 <strong style={{color:G.text}}>{nrUtilizari}</strong> utilizări
          </div>
          <div style={{fontSize:11, color:G.dim, marginTop:4}}>{expanded ? '▲ ascunde' : '▼ vezi detalii'}</div>
        </div>
      </div>

      {expanded && (
        <div style={{marginTop:14, paddingTop:14, borderTop:`1px solid ${G.border}`}}>
          {observatii && (
            <div style={{marginBottom:14, fontSize:12, color:G.muted, fontStyle:'italic', padding:'8px 12px', background:G.bg, borderRadius:6}}>
              💡 {observatii}
            </div>
          )}
          <div style={{fontSize:12, color:G.muted, fontWeight:600, marginBottom:8, textTransform:'uppercase', letterSpacing:0.5}}>
            🚛 Mașini pe care s-a folosit:
          </div>
          <div style={{display:'grid', gap:8}}>
            {masini.length === 0 && (
              <div style={{fontSize:12, color:G.dim, fontStyle:'italic'}}>Nicio mașină în istoric — codul e doar în catalog.</div>
            )}
            {masini.map(m => (
              <div key={m.active_id} style={{
                padding:'8px 12px', background:G.bg, borderRadius:6,
                border:`1px solid ${G.border}`,
              }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
                  <div style={{flex:1, minWidth:0}}>
                    <span style={{fontFamily:'ui-monospace, monospace', fontSize:12, color:G.logistica, fontWeight:700}}>{m.cod_intern || 'N/A'}</span>
                    {m.nr_inmatriculare && <span style={{marginLeft:8, fontSize:13, color:G.text}}>{m.nr_inmatriculare}</span>}
                    <span style={{marginLeft:8, fontSize:12, color:G.muted}}>{m.marca} {m.model}</span>
                  </div>
                  <div style={{fontSize:11, color:G.muted}}>
                    {m.utilizari.length} utiliz · ultima: {fmtDate(m.ultimaData)}
                  </div>
                </div>
                {m.utilizari.length > 1 && (
                  <div style={{marginTop:6, fontSize:10, color:G.dim, paddingLeft:0}}>
                    {m.utilizari.slice(0, 5).map((u, i) => (
                      <span key={i} style={{marginRight:10}}>
                        {fmtDate(u.data_service)} · {u.cantitate || '—'} {u.locatie_service ? `· ${u.locatie_service}` : ''}
                      </span>
                    ))}
                    {m.utilizari.length > 5 && <span>...</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {canEdit && sursa === 'catalog' && (
            <div style={{marginTop:14, display:'flex', justifyContent:'flex-end'}}>
              <button onClick={onDelete} style={{...S.btnS, color:G.red, borderColor:G.red+'55', fontSize:11, padding:'4px 10px'}}>🗑 Șterge cod din catalog</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTĂ PRINCIPALĂ
// ════════════════════════════════════════════════════════════════════════════
export default function PieseCatalogSection({ canEdit, showToast }) {
  const [catalog, setCatalog] = useState([])
  const [istoric, setIstoric] = useState([])
  const [activeMap, setActiveMap] = useState({})
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Toate')
  const [expandedId, setExpandedId] = useState(null)
  const [addModalOpen, setAddModalOpen] = useState(false)

  // ─── Încărcare date ───────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    const [catRes, istRes, actRes] = await Promise.all([
      supabase.from('logistica_piese_catalog').select('*').eq('activ', true).order('cod'),
      supabase.from('logistica_piese_istoric').select('id, active_id, piesa_cod_id, denumire, cod_piesa, cantitate, data_service, locatie_service, km_service'),
      supabase.from('logistica_active').select('id, cod_intern, nr_inmatriculare, marca, model'),
    ])
    if (catRes.error) showToast(`Eroare catalog: ${catRes.error.message}`, 'error')
    if (istRes.error) showToast(`Eroare istoric: ${istRes.error.message}`, 'error')
    if (actRes.error) showToast(`Eroare active: ${actRes.error.message}`, 'error')

    setCatalog(catRes.data || [])
    setIstoric(istRes.data || [])
    const m = {}
    for (const a of (actRes.data || [])) m[a.id] = a
    setActiveMap(m)
    setLoading(false)
  }, [showToast])

  useEffect(() => { loadAll() }, [loadAll])

  // ─── Procesare date: pentru fiecare cod din catalog + denumire din istoric ──
  // Returnez listă entries unificate: {cod, denumire, categorie, masini[]}
  const entries = useMemo(() => {
    const result = []

    // 1. Tot ce-i în CATALOG (chiar dacă nu are istoric)
    for (const c of catalog) {
      // Filtru categorie
      if (catFilter !== 'Toate' && c.categorie !== catFilter) continue

      // Adun toate utilizările cu acest cod_id
      const useByMasina = {}
      for (const i of istoric) {
        if (i.piesa_cod_id === c.id) {
          if (!useByMasina[i.active_id]) useByMasina[i.active_id] = []
          useByMasina[i.active_id].push(i)
        }
      }

      const masini = Object.entries(useByMasina).map(([aid, utilizari]) => {
        const act = activeMap[aid] || {}
        utilizari.sort((a, b) => (b.data_service || '').localeCompare(a.data_service || ''))
        return {
          active_id: Number(aid),
          cod_intern: act.cod_intern,
          nr_inmatriculare: act.nr_inmatriculare,
          marca: act.marca, model: act.model,
          utilizari,
          ultimaData: utilizari[0]?.data_service,
        }
      }).sort((a, b) => (b.ultimaData || '').localeCompare(a.ultimaData || ''))

      result.push({
        id: `cat-${c.id}`,
        sursa: 'catalog',
        catalogId: c.id,
        cod: c.cod,
        denumire: c.denumire,
        categorie: c.categorie,
        producator: c.producator,
        observatii: c.observatii,
        masini,
      })
    }

    // 2. Denumiri din ISTORIC care NU au cod (piesa_cod_id null) — grupare după denumire
    const denumiriIstoric = {}
    for (const i of istoric) {
      if (i.piesa_cod_id != null) continue // deja contat în catalog
      const key = norm(i.denumire)
      if (!key) continue
      if (!denumiriIstoric[key]) denumiriIstoric[key] = { denumire: i.denumire, utilizari: [] }
      denumiriIstoric[key].utilizari.push(i)
    }

    for (const key in denumiriIstoric) {
      const grup = denumiriIstoric[key]
      // Filtru categorie nu se aplică pe istoric fără cod (nu avem categorie)
      if (catFilter !== 'Toate') continue

      const useByMasina = {}
      for (const u of grup.utilizari) {
        if (!useByMasina[u.active_id]) useByMasina[u.active_id] = []
        useByMasina[u.active_id].push(u)
      }
      const masini = Object.entries(useByMasina).map(([aid, utilizari]) => {
        const act = activeMap[aid] || {}
        utilizari.sort((a, b) => (b.data_service || '').localeCompare(a.data_service || ''))
        return {
          active_id: Number(aid),
          cod_intern: act.cod_intern,
          nr_inmatriculare: act.nr_inmatriculare,
          marca: act.marca, model: act.model,
          utilizari,
          ultimaData: utilizari[0]?.data_service,
        }
      }).sort((a, b) => (b.ultimaData || '').localeCompare(a.ultimaData || ''))

      result.push({
        id: `den-${key}`,
        sursa: 'istoric',
        cod: null,
        denumire: grup.denumire,
        categorie: null,
        producator: null,
        observatii: null,
        masini,
      })
    }

    return result
  }, [catalog, istoric, activeMap, catFilter])

  // ─── Filtrare search ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = norm(search)
    return entries.filter(e => {
      if (e.cod && norm(e.cod).includes(q)) return true
      if (norm(e.denumire).includes(q)) return true
      if (e.producator && norm(e.producator).includes(q)) return true
      if (e.observatii && norm(e.observatii).includes(q)) return true
      // Caut și prin mașinile compatibile (cod_intern, plăcuță, marcă)
      for (const m of e.masini) {
        if (m.cod_intern && norm(m.cod_intern).includes(q)) return true
        if (m.nr_inmatriculare && norm(m.nr_inmatriculare).includes(q)) return true
        if (m.marca && norm(m.marca).includes(q)) return true
        if (m.model && norm(m.model).includes(q)) return true
      }
      return false
    })
  }, [entries, search])

  // Sortez: întâi cele din catalog (cu cod), apoi cele din istoric (fără cod)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.sursa !== b.sursa) return a.sursa === 'catalog' ? -1 : 1
      // În cadrul aceluiași grup, sortez după nr mașini compatibile (descrescător)
      return b.masini.length - a.masini.length
    })
  }, [filtered])

  // ─── Stats KPI ────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const totCatalog = catalog.length
    const totIstoric = istoric.length
    const masiniCuIstoric = new Set(istoric.map(i => i.active_id)).size
    const denumiriUnice = new Set(istoric.filter(i => !i.piesa_cod_id).map(i => norm(i.denumire))).size
    return { totCatalog, totIstoric, masiniCuIstoric, denumiriUnice }
  }, [catalog, istoric])

  // ─── Acțiuni ──────────────────────────────────────────────────────────────
  const deleteCod = async (catalogId, cod) => {
    if (!confirm(`Ștergi codul "${cod}" din catalog?\n\nIstoricul rămâne intact (piesa_cod_id devine NULL).`)) return
    const { error } = await supabase.from('logistica_piese_catalog').update({ activ: false }).eq('id', catalogId)
    if (error) { showToast(`Eroare: ${error.message}`, 'error'); return }
    showToast(`✓ Cod "${cod}" dezactivat`, 'success')
    loadAll()
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div style={{padding:40, textAlign:'center', color:G.muted, fontSize:14}}>Se încarcă catalogul de piese…</div>
  }

  return (
    <>
      {/* KPI Header */}
      <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
        <KPIMic icon="🔑" label="Coduri în catalog" value={kpi.totCatalog} color={G.green}
          sub={kpi.denumiriUnice > 0 ? `+${kpi.denumiriUnice} denumiri fără cod` : 'toate cu cod identificat'} />
        <KPIMic icon="🔄" label="Total utilizări" value={kpi.totIstoric} color={G.blue}
          sub={`pe ${kpi.masiniCuIstoric} mașini`} />
        <KPIMic icon="🚛" label="Mașini cu istoric" value={kpi.masiniCuIstoric} color={G.purple} />
      </div>

      {/* Bară căutare + filtru + add */}
      <div style={{...S.card, padding:14, marginBottom:14}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
          <input
            placeholder="🔍 Caută cod (MAC30130, CT1078K1) sau denumire (FILTRU ULEI) sau plăcuță mașină (PH 90 YZO)..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{...S.input, flex:1, minWidth:300}}
            autoFocus
          />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={{...S.input, width:'auto', padding:'7px 11px', fontSize:13, cursor:'pointer'}}>
            <option value="Toate">Toate categoriile</option>
            {CATEGORII_PIESE.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {canEdit && (
            <button onClick={() => setAddModalOpen(true)} style={{...S.btnP, padding:'8px 16px', fontSize:13}}>
              ➕ Adaugă cod
            </button>
          )}
        </div>
        {search && (
          <div style={{fontSize:11, color:G.muted, marginTop:8}}>
            Găsite: <strong style={{color:G.text}}>{sorted.length}</strong> rezultat{sorted.length === 1 ? '' : 'e'}
            {sorted.length > 0 && ` · ${sorted.filter(e => e.sursa === 'catalog').length} din catalog · ${sorted.filter(e => e.sursa === 'istoric').length} din denumiri istoric`}
          </div>
        )}
      </div>

      {/* Lista rezultate */}
      {sorted.length === 0 ? (
        <div style={{...S.card, padding:40, textAlign:'center', color:G.muted, fontSize:14}}>
          {search.trim() ? (
            <>
              <div style={{fontSize:48, marginBottom:12}}>🔍</div>
              <div style={{fontSize:16, marginBottom:6, color:G.text}}>Niciun rezultat pentru „{search}"</div>
              <div style={{fontSize:12, color:G.dim}}>Încearcă o căutare mai scurtă sau verifică ortografia.</div>
              {canEdit && (
                <button onClick={() => setAddModalOpen(true)} style={{...S.btnP, marginTop:16, padding:'8px 18px', fontSize:13}}>
                  ➕ Adaugă acest cod în catalog
                </button>
              )}
            </>
          ) : (
            <>Catalog gol — apasă <strong style={{color:G.text}}>➕ Adaugă cod</strong> pentru a începe.</>
          )}
        </div>
      ) : (
        <div style={{display:'grid', gap:10}}>
          {sorted.map(entry => (
            <CodCard
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              canEdit={canEdit}
              onDelete={() => deleteCod(entry.catalogId, entry.cod)}
            />
          ))}
        </div>
      )}

      {/* Footer mic cu hint */}
      <div style={{marginTop:14, padding:'10px 14px', fontSize:11, color:G.dim, textAlign:'center'}}>
        💡 Codurile cu chenar <span style={{color:G.green}}>verde</span> sunt în catalog (cu detalii). Cele <span style={{color:G.muted}}>gri</span> sunt grupări de piese fără cod din registrele de mentenanță — apasă „Adaugă cod" pentru a le îmbogăți.
      </div>

      {addModalOpen && (
        <AddCodModal
          onClose={() => setAddModalOpen(false)}
          onSaved={() => { setAddModalOpen(false); loadAll() }}
          showToast={showToast}
        />
      )}
    </>
  )
}
