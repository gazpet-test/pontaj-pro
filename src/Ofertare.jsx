// ════════════════════════════════════════════════════════════════
// Ofertare.jsx — Modulul OFERTARE
// LIVE: 19.05.2026 placeholder (Etapa 15 Faza 1)
// v0.5: 12.06.2026 — Documente calitate materiale (din comenzi furnizor)
// v1.0: 25.06.2026 — Tab-uri + Modul 2 Probe de Presiune (Oferte):
//   • Tab „🏅 Documente calitate" (existent) | „🔬 Oferte probe presiune" (nou)
//   • CRUD oferte probe (preia probe_calcule → costuri comerciale → total + TVA)
//   • Export Excel (xlsx-js-style) + PDF (html2canvas + jsPDF) cu semnături
//   • Sub-filtru Pneumatic | Hidraulic
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { calcProbe, pretPropusProba, PRAG_MINIM_PROBA_LEI } from './utils/probeCalc.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', greenBg:'#238636', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}

const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
}

const TVA_OFERTA = 21
// Marker deploy — confirmă în consolă (F12) că versiunea nouă e live
if (typeof window !== 'undefined') console.log('%c[Ofertare] build probe v2 — TVA 21% · checkbox include · discount · tarif/utilaj', 'color:#3FB6E2;font-weight:bold')
const fmtLei = v => (v||v===0) ? new Intl.NumberFormat('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v) : '—'
const fmtH = h => { const n=Number(h)||0; if(n===0)return'0 h'; if(n<1)return`${Math.round(n*60)} min`; return`${n.toFixed(2)} h` }

const OFERTA_STATUS = {
  draft:     { label:'Draft',     color:G.muted,  icon:'📝' },
  trimisa:   { label:'Trimisă',   color:G.blue,   icon:'📤' },
  acceptata: { label:'Acceptată', color:G.teal,   icon:'✅' },
  respinsa:  { label:'Respinsă',  color:G.red,    icon:'❌' },
  castigata: { label:'Câștigată', color:G.green,  icon:'🏆' },
}

// ════════════════════════════════════════════════════════════════
// PAGINA PRINCIPALĂ — tab-uri
// ════════════════════════════════════════════════════════════════
export default function OfertarePage() {
  const [tab, setTab] = useState('calitate')

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: '0 28px', position: 'sticky', top: 60, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52 }}>
          <div style={{ width: 30, height: 30, background: `linear-gradient(135deg,${G.ofertare},#1F6FEB)`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Ofertare</div>
          <div style={{ display:'flex', gap:6, marginLeft:18 }}>
            {[
              { k:'calitate', l:'🏅 Documente calitate' },
              { k:'probe',    l:'🔬 Oferte probe presiune' },
            ].map(t => (
              <button key={t.k} onClick={() => setTab(t.k)} style={{
                padding:'7px 16px', border:'none', background: tab===t.k ? G.ofertare+'22' : 'transparent',
                color: tab===t.k ? G.ofertare : G.muted, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700,
              }}>{t.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
        {tab === 'calitate' && <DocumenteCalitateTab />}
        {tab === 'probe' && <OferteProbeTab />}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 1 — Documente calitate materiale (existent, neschimbat)
// ════════════════════════════════════════════════════════════════
function DocumenteCalitateTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [rDocs, rCmd, rFz, rProj] = await Promise.all([
          supabase.from('comenzi_furnizor_documente').select('*').in('tip', ['calitate', 'declaratie', 'aviz']).order('uploadat_la', { ascending: false }),
          supabase.from('comenzi_furnizor').select('id, numar_comanda, furnizor_id, proiect_id'),
          supabase.from('logistica_furnizori').select('id, nume'),
          supabase.from('executie_proiecte').select('id, nume, cod_intern'),
        ])
        const cmdMap = Object.fromEntries((rCmd.data || []).map(c => [c.id, c]))
        const fzMap  = Object.fromEntries((rFz.data || []).map(f => [f.id, f.nume]))
        const pjMap  = Object.fromEntries((rProj.data || []).map(p => [p.id, p]))
        setRows((rDocs.data || []).map(d => {
          const cmd = cmdMap[d.comanda_id]
          const pj = cmd?.proiect_id ? pjMap[cmd.proiect_id] : null
          return {
            ...d,
            _cmd: cmd?.numar_comanda || `#${d.comanda_id}`,
            _comandaId: d.comanda_id,
            _furnizor: (cmd?.furnizor_id && fzMap[cmd.furnizor_id]) || '—',
            _proiectId: cmd?.proiect_id || null,
            _proiect: pj ? (pj.cod_intern || pj.nume) : 'Fără proiect',
          }
        }))
      } finally { setLoading(false) }
    })()
  }, [])

  const openDoc = async (path) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const downloadDoc = async (path, nume) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120, { download: nume || true })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const EMOJI_TIP = { calitate: '🏅', declaratie: '📜', aviz: '🚚' }

  const filtered = useMemo(() => {
    if (!search) return rows
    const s = search.toLowerCase()
    return rows.filter(r => (r.fisier_nume || '').toLowerCase().includes(s)
      || (r._furnizor || '').toLowerCase().includes(s)
      || (r._cmd || '').toLowerCase().includes(s)
      || (r._proiect || '').toLowerCase().includes(s))
  }, [rows, search])

  const grupe = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const k = r._proiect
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>🏅 Documente calitate materiale</div>
          <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
            Certificatele de pe comenzile furnizor (Achiziții) · {rows.length} {rows.length === 1 ? 'document' : 'documente'} · {grupe.length} proiecte
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Caută document / furnizor / proiect..."
          style={{ padding: '9px 13px', background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, color: G.text, fontSize: 13, outline: 'none', minWidth: 260 }} />
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă...</div>}

      {!loading && !grupe.length && (
        <div style={{ padding: 50, textAlign: 'center', background: G.surface, borderRadius: 12, border: `1px dashed ${G.border}` }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🏅</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{search ? 'Niciun document pe căutarea curentă.' : 'Niciun document de calitate încă.'}</div>
          <div style={{ fontSize: 12, color: G.muted }}>Certificatele se încarcă pe comenzi în modulul Achiziții (secțiunea 📎) și migrează automat aici.</div>
        </div>
      )}

      {!loading && grupe.map(([proiect, docs]) => (
        <div key={proiect} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${G.border}`, background: G.card2 }}>
            <span style={{ fontSize: 16 }}>📂</span>
            <span style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{proiect}</span>
            <span style={{ background: G.ofertare + '22', color: G.ofertare, border: `1px solid ${G.ofertare}55`, borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>
              {docs.length} {docs.length === 1 ? 'document' : 'documente'}
            </span>
          </div>
          {docs.map(d => (
            <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 110px 140px', gap: 10, alignItems: 'center', padding: '9px 16px', borderBottom: `1px solid ${G.border}`, fontSize: 12.5 }}>
              <button onClick={() => openDoc(d.fisier_path)} title={d.fisier_nume}
                style={{ background: 'none', border: 'none', color: G.green, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {EMOJI_TIP[d.tip] || '📄'} {d.fisier_nume || d.fisier_path.split('/').pop()}
              </button>
              <a href={`/achizitii?id=${d._comandaId}`} style={{ color: G.muted, fontSize: 11.5, fontFamily: 'monospace', textDecoration: 'none' }} title="Deschide comanda în Achiziții">🛒 {d._cmd}</a>
              <span style={{ color: G.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏭 {d._furnizor}</span>
              <span style={{ color: G.dim, fontSize: 11 }}>{d.uploadat_la ? new Date(d.uploadat_la).toLocaleDateString('ro-RO') : '—'}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => openDoc(d.fisier_path)} style={{ padding: '4px 10px', background: G.green + '22', border: `1px solid ${G.green}44`, borderRadius: 6, color: G.green, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>👁 Vezi</button>
                <button onClick={() => downloadDoc(d.fisier_path, d.fisier_nume)} title="Descarcă" style={{ padding: '4px 10px', background: '#58A6FF22', border: '1px solid #58A6FF44', borderRadius: 6, color: '#58A6FF', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>⬇</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB 2 — Oferte Probe de Presiune
// ════════════════════════════════════════════════════════════════
function OferteProbeTab() {
  const [oferte, setOferte] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtruFluid, setFiltruFluid] = useState('toate')
  const [editOferta, setEditOferta] = useState(null)
  const [profile, setProfile] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, kind) => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('id, name, is_owner, can_manage_contracts').eq('id', user.id).single()
        setProfile(p)
      }
    })()
  }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('probe_oferte')
      .select('*, probe_calcule(tip_fluid, lungime_m, presiune_bar, durata_total_h, probe_diametre(dn_label))')
      .order('created_at', { ascending: false })
    setOferte(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const ofFiltered = useMemo(() => {
    if (filtruFluid === 'toate') return oferte
    return oferte.filter(o => o.probe_calcule?.tip_fluid === filtruFluid)
  }, [oferte, filtruFluid])

  const canWrite = profile?.is_owner || profile?.can_manage_contracts

  return (
    <>
      {toast && (
        <div style={{position:'fixed', bottom:24, left:24, padding:'10px 16px', background: toast.kind==='err'?G.red:G.green, color:'#fff', borderRadius:8, fontSize:12, fontWeight:600, zIndex:10001}}>{toast.msg}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>🔬 Oferte probe de presiune</div>
          <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
            Preia un calcul din Execuție → costuri comerciale → Excel/PDF · {oferte.length} oferte
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{display:'inline-flex', background:G.surface, borderRadius:8, padding:3, gap:3, border:`1px solid ${G.border}`}}>
          {[{k:'toate',l:'Toate'},{k:'aer',l:'💨 Pneumatic'},{k:'apa',l:'💧 Hidraulic'}].map(t=>(
            <button key={t.k} onClick={()=>setFiltruFluid(t.k)} style={{padding:'6px 12px', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, background: filtruFluid===t.k?G.ofertare:'transparent', color: filtruFluid===t.k?'#0D1117':G.muted}}>{t.l}</button>
          ))}
        </div>
        {canWrite && (
          <button onClick={() => setEditOferta({})} style={{...S.btnP}}>＋ Ofertă nouă</button>
        )}
      </div>

      {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă...</div>}

      {!loading && !ofFiltered.length && (
        <div style={{ padding: 50, textAlign: 'center', background: G.surface, borderRadius: 12, border: `1px dashed ${G.border}` }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔬</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Nicio ofertă de probe încă.</div>
          <div style={{ fontSize: 12, color: G.muted }}>Apasă „＋ Ofertă nouă" și pornește de la un calcul salvat din Execuție → Șantiere → Probe presiune.</div>
        </div>
      )}

      {!loading && ofFiltered.length > 0 && (
        <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr 160px 130px 120px 90px', gap:12, padding:'11px 16px', borderBottom:`1px solid ${G.border}`, background:G.card2, fontSize:11, fontWeight:800, color:G.muted, textTransform:'uppercase' }}>
            <span></span><span>Nr / Client</span><span>Parametri</span><span>Total + TVA</span><span>Status</span><span></span>
          </div>
          {ofFiltered.map((o, i) => {
            const si = OFERTA_STATUS[o.status] || OFERTA_STATUS.draft
            const calc = o.probe_calcule
            return (
              <div key={o.id} style={{ display:'grid', gridTemplateColumns:'auto 1fr 160px 130px 120px 90px', gap:12, alignItems:'center', padding:'11px 16px', borderBottom: i<ofFiltered.length-1?`1px solid ${G.border}`:'none', fontSize:12.5, background: i%2?G.bg+'44':'transparent' }}>
                <span style={{fontSize:16}}>{calc?.tip_fluid==='apa'?'💧':'💨'}</span>
                <div>
                  <div style={{fontWeight:700, color:G.text}}>{o.nr_oferta}</div>
                  <div style={{fontSize:11, color:G.muted}}>{o.client||'—'}{o.localitate?` · ${o.localitate}`:''}</div>
                </div>
                <span style={{fontSize:11.5, color:G.muted}}>
                  {calc?.probe_diametre?.dn_label||'—'} · {fmtLei(calc?.lungime_m)}m · {fmtLei(calc?.presiune_bar)} bar
                </span>
                <div>
                  <div style={{fontWeight:800, color:G.green}}>{fmtLei(o.total_lei * (1+TVA_OFERTA/100))} lei</div>
                  <div style={{fontSize:10, color:G.dim}}>fără TVA: {fmtLei(o.total_lei)}</div>
                </div>
                <span style={{display:'inline-flex', alignItems:'center', gap:5, color:si.color, fontWeight:700, fontSize:12}}>{si.icon} {si.label}</span>
                <button onClick={()=>setEditOferta(o)} style={{...S.btnS, padding:'5px 10px', fontSize:11}}>Deschide</button>
              </div>
            )
          })}
        </div>
      )}

      {editOferta && (
        <OfertaModal oferta={editOferta} profile={profile}
          onClose={()=>setEditOferta(null)}
          onSaved={()=>{ setEditOferta(null); load(); showToast('✓ Ofertă salvată') }}
          onError={e=>showToast(e,'err')} />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL OFERTĂ — selectare calcul + costuri + total + export
// ════════════════════════════════════════════════════════════════
function OfertaModal({ oferta, profile, onClose, onSaved, onError }) {
  const isNew = !oferta.id
  const [calcule, setCalcule] = useState([])
  const [diametre, setDiametre] = useState([])
  const [configs, setConfigs] = useState([])
  const [transportTarife, setTransportTarife] = useState([])
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showTarife, setShowTarife] = useState(false)
  // Sursa calculului: 'nou' = calcul inline (fără proiect, pentru ofertare) | 'salvat' = dintr-un calcul existent
  const [sursaCalc, setSursaCalc] = useState(isNew ? 'nou' : 'salvat')

  // Calcul inline (fără proiect — fază comercială)
  const [ci, setCi] = useState({ tipFluid:'aer', dnId:'', lungime:'', presiune:'', configId:'' })
  const setCiK = (k,v) => setCi(p => ({...p,[k]:v}))

  const [f, setF] = useState({
    calc_id: oferta.calc_id || '',
    nr_oferta: oferta.nr_oferta || '',
    data_oferta: oferta.data_oferta || new Date().toISOString().slice(0,10),
    client: oferta.client || '',
    localitate: oferta.localitate || '',
    distanta_km: oferta.distanta_km ?? '',
    transport_lei: oferta.transport_lei ?? 0,
    pistonare_lei: oferta.pistonare_lei ?? 0,
    uscare_lei: oferta.uscare_lei ?? 0,
    calibrare_lei: oferta.calibrare_lei ?? 0,
    proba_lei: oferta.proba_lei ?? 0,
    stat_dispozitie_lei: oferta.stat_dispozitie_lei ?? 0,
    extra_lei: oferta.extra_lei ?? 0,
    discount_pct: oferta.discount_pct ?? 0,
    inc_pistonare: oferta.inc_pistonare ?? true,
    inc_uscare: oferta.inc_uscare ?? true,
    inc_calibrare: oferta.inc_calibrare ?? true,
    status: oferta.status || 'draft',
    observatii: oferta.observatii || '',
  })
  const setK = (k,v) => setF(p => ({...p,[k]:v}))

  useEffect(() => {
    (async () => {
      const [cRes, dRes, cfgRes, ttRes] = await Promise.all([
        supabase.from('probe_calcule')
          .select('id, tip_fluid, lungime_m, presiune_bar, v_conducta_mc, durata_proba_h, durata_pistonare_h, durata_total_h, consum_motorina_l, proiect_id, config_id, probe_diametre(dn_label), probe_configuratii(denumire, tarif_lei_h, tarif_lei_mc, categorie_transport), executie_proiecte(cod_intern, nume)')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('probe_diametre').select('*').eq('activ', true).order('ordine'),
        supabase.from('probe_configuratii').select('*').eq('activ', true).order('id'),
        supabase.from('probe_transport_tarife').select('*'),
      ])
      setCalcule(cRes.data || [])
      setDiametre(dRes.data || [])
      setConfigs(cfgRes.data || [])
      setTransportTarife(ttRes.data || [])
    })()
  }, [])

  // Tarif transport pentru o categorie (V1/V2)
  const tarifTransport = (categorie) => transportTarife.find(t => t.categorie === categorie)
  // Calcul transport: distanță × tarif × (2 dacă dus-întors)
  const calcTransport = (categorie, km) => {
    const t = tarifTransport(categorie)
    if (!t || !km) return 0
    return Number(km) * Number(t.tarif_lei_km) * (t.dus_intors ? 2 : 1)
  }

  // ─── Calcul inline live ───
  const ciDn = diametre.find(d => String(d.id) === String(ci.dnId))
  const ciCfg = configs.find(c => String(c.id) === String(ci.configId))
  const ciConfigFiltrate = useMemo(() => {
    const P = Number(ci.presiune)||0
    return configs.filter(c => c.tip_fluid === ci.tipFluid && (P===0 || Number(c.presiune_max_bar) >= P))
  }, [configs, ci.tipFluid, ci.presiune])
  const ciRez = useMemo(() => {
    if (!ciDn || !ci.lungime || !ci.presiune || !ciCfg) return null
    return calcProbe({ dn: ciDn, lungime_m: ci.lungime, presiune_bar: ci.presiune, cfg: ciCfg })
  }, [ciDn, ci.lungime, ci.presiune, ciCfg])

  // Referința LMF (etalon de preț) pentru prețul propus spre ofertare
  const refLMF = useMemo(() => configs.find(c => c.cod === 'LMF100') || configs.find(c => String(c.id) === '1') || null, [configs])

  // calc folosit (din salvat SAU obiect virtual din inline pentru afișaj/export)
  const calcSalvat = calcule.find(c => String(c.id) === String(f.calc_id))
  const calc = sursaCalc === 'salvat' ? calcSalvat : (ciRez ? {
    tip_fluid: ci.tipFluid, lungime_m: Number(ci.lungime), presiune_bar: Number(ci.presiune),
    v_conducta_mc: ciRez.v_conducta_mc, durata_total_h: ciRez.durata_total_h, consum_motorina_l: ciRez.consum_motorina_l,
    probe_diametre: { dn_label: ciDn?.dn_label }, probe_configuratii: { denumire: ciCfg?.denumire },
  } : null)

  // Pre-completare costuri din calcul salvat
  const prefillFromCalc = (c) => {
    if (!c) return
    const cat = c.probe_configuratii?.categorie_transport
    const transp = calcTransport(cat, f.distanta_km)
    if (c.tip_fluid === 'aer') {
      const cfgFull = configs.find(x => String(x.id) === String(c.config_id))
      const tarif = parseFloat(c.probe_configuratii?.tarif_lei_h || 0)
      const pist = parseFloat(c.durata_pistonare_h||0) * tarif
      const pp = pretPropusProba({ v_conducta_mc: c.v_conducta_mc, presiune_bar: c.presiune_bar, ref: refLMF, spor_pct: cfgFull?.spor_pct })
      const proba = pp.aplicabil ? pp.pret_final : parseFloat(c.durata_proba_h||0) * tarif
      setF(p => ({ ...p, transport_lei:+transp.toFixed(2), pistonare_lei:+pist.toFixed(2), uscare_lei:+pist.toFixed(2), calibrare_lei:+pist.toFixed(2), proba_lei:+proba.toFixed(2) }))
    } else {
      const pu = parseFloat(c.probe_configuratii?.tarif_lei_mc || 0)
      const vMc = parseFloat(c.v_conducta_mc||0)
      setF(p => ({ ...p, transport_lei:+transp.toFixed(2), proba_lei:+(vMc*pu).toFixed(2), pistonare_lei:0, uscare_lei:0, calibrare_lei:0 }))
    }
  }
  const onSelectCalc = (id) => {
    setK('calc_id', id)
    const c = calcule.find(x => String(x.id) === String(id))
    if (c && isNew) prefillFromCalc(c)
  }

  // Pre-completare costuri din calcul INLINE (durată × tarif config + transport categorie)
  const prefillFromInline = () => {
    if (!ciRez || !ciCfg) return
    const transp = calcTransport(ciCfg.categorie_transport, f.distanta_km)
    if (ci.tipFluid === 'aer') {
      const tarif = parseFloat(ciCfg.tarif_lei_h || 0)
      const pist = (ciRez.durata_pistonare_h||0) * tarif
      const pp = pretPropusProba({ v_conducta_mc: ciRez.v_conducta_mc, presiune_bar: ci.presiune, ref: refLMF, spor_pct: ciCfg.spor_pct })
      const proba = pp.aplicabil ? pp.pret_final : (ciRez.durata_proba_h||0) * tarif
      setF(p => ({ ...p, transport_lei:+transp.toFixed(2), pistonare_lei:+pist.toFixed(2), uscare_lei:+pist.toFixed(2), calibrare_lei:+pist.toFixed(2), proba_lei:+proba.toFixed(2) }))
    } else {
      const pu = parseFloat(ciCfg.tarif_lei_mc || 0)
      setF(p => ({ ...p, transport_lei:+transp.toFixed(2), proba_lei:+((ciRez.v_conducta_mc||0)*pu).toFixed(2), pistonare_lei:0, uscare_lei:0, calibrare_lei:0 }))
    }
  }

  const discountProba = useMemo(() => (parseFloat(f.proba_lei)||0) * (parseFloat(f.discount_pct)||0) / 100, [f.proba_lei, f.discount_pct])

  // Preț propus spre ofertare — unificat (calcul nou SAU salvat), pentru badge + buton „folosește"
  const pretPropusActiv = useMemo(() => {
    let v_mc, P, cfgFull
    if (sursaCalc === 'nou') {
      if (!ciRez || ci.tipFluid !== 'aer') return null
      v_mc = ciRez.v_conducta_mc; P = Number(ci.presiune)||0; cfgFull = ciCfg
    } else {
      const c = calcSalvat
      if (!c || c.tip_fluid !== 'aer') return null
      v_mc = c.v_conducta_mc; P = Number(c.presiune_bar)||0
      cfgFull = configs.find(x => String(x.id) === String(c.config_id))
    }
    if (!refLMF) return null
    const pp = pretPropusProba({ v_conducta_mc: v_mc, presiune_bar: P, ref: refLMF, spor_pct: cfgFull?.spor_pct })
    return { ...pp, spor: Number(cfgFull?.spor_pct)||0 }
  }, [sursaCalc, ciRez, ci.tipFluid, ci.presiune, ciCfg, calcSalvat, refLMF, configs])
  const folosestePretPropus = () => {
    if (pretPropusActiv?.aplicabil) setK('proba_lei', +pretPropusActiv.pret_final.toFixed(2))
  }
  const totalFaraTva = useMemo(() => {
    let t = 0
    t += parseFloat(f.transport_lei)||0
    if (f.inc_pistonare) t += parseFloat(f.pistonare_lei)||0
    if (f.inc_uscare)    t += parseFloat(f.uscare_lei)||0
    if (f.inc_calibrare) t += parseFloat(f.calibrare_lei)||0
    t += (parseFloat(f.proba_lei)||0) - discountProba
    t += parseFloat(f.stat_dispozitie_lei)||0
    t += parseFloat(f.extra_lei)||0
    return t
  }, [f, discountProba])
  const tva = totalFaraTva * TVA_OFERTA / 100
  const totalCuTva = totalFaraTva + tva

  const genNrOferta = async () => {
    const an = new Date().getFullYear()
    const { data } = await supabase.from('probe_oferte').select('nr_oferta').like('nr_oferta', `PP-${an}-%`)
    const maxN = (data||[]).reduce((mx, r) => { const m=/PP-\d+-(\d+)/.exec(r.nr_oferta||''); return m?Math.max(mx,parseInt(m[1])):mx }, 0)
    return `PP-${an}-${String(maxN+1).padStart(3,'0')}`
  }

  // Notifică departamentul Achiziții să întocmească contractul (ofertă câștigată/acceptată)
  const notificaAchizitii = async (nrOferta, client) => {
    const { data: useri } = await supabase.from('profiles').select('id').eq('can_process_achizitii', true)
    if (!useri?.length) return
    const rows = useri.map(u => ({
      profile_id: u.id, type: 'oferta_castigata', modul: 'Comercial',
      title: '🏆 Ofertă câștigată — întocmește contract',
      message: `Oferta ${nrOferta}${client?` (${client})`:''} a fost marcată câștigată. Te rog întocmește contractul.`,
      link_to: '/ofertare?tab=probe',
    }))
    await supabase.from('notifications').insert(rows)
  }

  const save = async () => {
    setBusy(true)
    try {
      // 1. Determinăm calc_id: salvat existent SAU salvăm calculul inline (proiect_id NULL = calcul de ofertă)
      let calcId = f.calc_id
      if (sursaCalc === 'nou') {
        if (!ciRez) { setBusy(false); return onError('Completează calculul (diametru, lungime, presiune, configurație)') }
        const { data: cNew, error: cErr } = await supabase.from('probe_calcule').insert({
          proiect_id: null, tronson_id: null, tip_fluid: ci.tipFluid,
          dn_id: Number(ci.dnId), lungime_m: Number(ci.lungime), presiune_bar: Number(ci.presiune),
          config_id: Number(ci.configId),
          v_conducta_mc: ciRez.v_conducta_mc, v_la_presiune_mc: ciRez.v_la_presiune_mc,
          durata_proba_h: ciRez.durata_proba_h, durata_pistonare_h: ciRez.durata_pistonare_h,
          durata_total_h: ciRez.durata_total_h, consum_motorina_l: ciRez.consum_motorina_l,
          timp_umplere_h: ciRez.timp_umplere_h||null, timp_presurizare_h: ciRez.timp_presurizare_h||null,
          valoare_lei: ciRez.valoare_lei||null, status: 'planificata', created_by: profile?.id||null,
        }).select('id').single()
        if (cErr) { setBusy(false); return onError('Eroare calcul: ' + cErr.message) }
        calcId = cNew.id
      }
      if (!calcId) { setBusy(false); return onError('Selectează sau creează un calcul de probă') }

      let nr = f.nr_oferta
      if (!nr) nr = await genNrOferta()
      const payload = {
        calc_id: Number(calcId), nr_oferta: nr, data_oferta: f.data_oferta,
        client: f.client.trim()||null, localitate: f.localitate.trim()||null,
        distanta_km: f.distanta_km?Number(f.distanta_km):null,
        transport_lei: Number(f.transport_lei)||0, pistonare_lei: Number(f.pistonare_lei)||0,
        uscare_lei: Number(f.uscare_lei)||0, calibrare_lei: Number(f.calibrare_lei)||0,
        proba_lei: Number(f.proba_lei)||0, stat_dispozitie_lei: Number(f.stat_dispozitie_lei)||0,
        extra_lei: Number(f.extra_lei)||0,
        discount_pct: Number(f.discount_pct)||0,
        inc_pistonare: !!f.inc_pistonare, inc_uscare: !!f.inc_uscare, inc_calibrare: !!f.inc_calibrare,
        status: f.status, observatii: f.observatii.trim()||null,
        created_by: profile?.id||null,
      }
      let error
      if (isNew) { ({ error } = await supabase.from('probe_oferte').insert(payload)) }
      else { ({ error } = await supabase.from('probe_oferte').update(payload).eq('id', oferta.id)) }
      if (error) { setBusy(false); return onError('Eroare: ' + error.message) }

      // 2. Dacă oferta tocmai a devenit câștigată/acceptată → notifică Achiziții
      const eraCastigata = ['castigata','acceptata'].includes(oferta.status)
      const esteCastigata = ['castigata','acceptata'].includes(f.status)
      if (esteCastigata && !eraCastigata) await notificaAchizitii(nr, f.client.trim())

      setBusy(false)
      onSaved()
    } catch(e) { setBusy(false); onError('Eroare: ' + e.message) }
  }

  const exportData = () => ({ ...f, calc, totalFaraTva, tva, totalCuTva, discountProba, nr_oferta: f.nr_oferta||'PP-DRAFT', intocmit: profile?.name||'' })

  const handleExcel = async () => { setExporting(true); try { await generateOfertaExcel(exportData()) } catch(e){ onError('Eroare Excel: '+e.message) } setExporting(false) }
  const handlePDF = async () => { setExporting(true); try { await generateOfertaPDF(exportData()) } catch(e){ onError('Eroare PDF: '+e.message) } setExporting(false) }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10000, padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.surface, border:`1px solid ${G.border}`, borderRadius:12, padding:24, width:'100%', maxWidth:680, maxHeight:'92vh', overflowY:'auto'}}>
        <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:18}}>
          <h3 style={{margin:0, fontSize:17, color:G.text}}>{isNew?'➕ Ofertă nouă':`🔬 ${f.nr_oferta}`}</h3>
          <div style={{flex:1}} />
          <button onClick={onClose} style={{background:'none', border:'none', color:G.muted, fontSize:22, cursor:'pointer'}}>×</button>
        </div>

        {/* Sursă calcul: Calcul nou (inline, fără proiect) vs Din calcul salvat */}
        {isNew && (
          <div style={{display:'inline-flex', background:G.bg, borderRadius:8, padding:3, gap:3, marginBottom:14, border:`1px solid ${G.border}`}}>
            {[{k:'nou',l:'🧮 Calcul nou'},{k:'salvat',l:'📋 Din calcul salvat'}].map(t=>(
              <button key={t.k} onClick={()=>setSursaCalc(t.k)} style={{padding:'7px 16px', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, background: sursaCalc===t.k?G.ofertare:'transparent', color: sursaCalc===t.k?'#0D1117':G.muted}}>{t.l}</button>
            ))}
          </div>
        )}

        {/* CALCUL NOU INLINE (fără proiect — fază comercială) */}
        {sursaCalc === 'nou' && (
          <div style={{background:G.bg, borderRadius:10, padding:'16px 18px', marginBottom:14}}>
            <div style={{display:'inline-flex', background:G.surface, borderRadius:8, padding:3, gap:3, marginBottom:12, border:`1px solid ${G.border}`}}>
              {[{k:'aer',l:'💨 Pneumatic'},{k:'apa',l:'💧 Hidraulic'}].map(t=>(
                <button key={t.k} onClick={()=>{setCiK('tipFluid',t.k); setCiK('configId','')}} style={{padding:'6px 14px', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, background: ci.tipFluid===t.k?G.ofertare:'transparent', color: ci.tipFluid===t.k?'#0D1117':G.muted}}>{t.l}</button>
              ))}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10}}>
              <div><label style={S.lbl}>Diametru (DN)</label>
                <select value={ci.dnId} onChange={e=>setCiK('dnId',e.target.value)} style={S.input}>
                  <option value="">— DN —</option>
                  {diametre.map(d=><option key={d.id} value={d.id}>{d.dn_label} ({fmtLei(d.diametru_extern_mm)} mm)</option>)}
                </select></div>
              <div><label style={S.lbl}>Configurație (≥ presiune)</label>
                <select value={ci.configId} onChange={e=>setCiK('configId',e.target.value)} style={S.input}>
                  <option value="">— config —</option>
                  {ciConfigFiltrate.map(c=><option key={c.id} value={c.id}>{c.denumire} · {fmtLei(c.presiune_max_bar)} bar max</option>)}
                </select></div>
              <div><label style={S.lbl}>Lungime (m)</label><input type="number" value={ci.lungime} onChange={e=>setCiK('lungime',e.target.value)} style={S.input} placeholder="ex: 1000" /></div>
              <div><label style={S.lbl}>Presiune probă (bar)</label><input type="number" value={ci.presiune} onChange={e=>{setCiK('presiune',e.target.value); setCiK('configId','')}} style={S.input} placeholder="ex: 10" /></div>
            </div>
            {ciRez ? (
              <div style={{display:'flex', gap:16, flexWrap:'wrap', alignItems:'center', fontSize:12, color:G.muted, paddingTop:6, borderTop:`1px solid ${G.border}`}}>
                <span>Volum: <strong style={{color:G.blue}}>{fmtLei(ciRez.v_conducta_mc)} mc</strong></span>
                <span>Durată: <strong style={{color:G.text}}>{fmtH(ciRez.durata_total_h)}</strong></span>
                <span>Consum: <strong style={{color:G.orange}}>{fmtLei(ciRez.consum_motorina_l)} L</strong></span>
                <div style={{flex:1}} />
                <button onClick={prefillFromInline} style={{...S.btnS, padding:'5px 12px', fontSize:11}}>↓ Pre-completează costuri</button>
              </div>
            ) : (
              <div style={{fontSize:11, color:G.dim, paddingTop:6}}>Completează DN, lungime, presiune și configurație pentru calcul instant.</div>
            )}
            <div style={{fontSize:10, color:G.dim, marginTop:8}}>💡 Calcul pentru ofertă — nu necesită proiect. Se salvează automat la salvarea ofertei.</div>
          </div>
        )}

        {/* DIN CALCUL SALVAT */}
        {sursaCalc === 'salvat' && (
          <div style={{marginBottom:14}}>
            <label style={S.lbl}>Calcul de probă existent</label>
            <select value={f.calc_id} onChange={e=>onSelectCalc(e.target.value)} style={S.input} disabled={!isNew}>
              <option value="">— alege calculul —</option>
              {calcule.map(c => (
                <option key={c.id} value={c.id}>
                  #{c.id} · {c.tip_fluid==='apa'?'💧':'💨'} {c.probe_diametre?.dn_label||'?'} · {fmtLei(c.lungime_m)}m · {fmtLei(c.presiune_bar)}bar · {c.executie_proiecte?.cod_intern||c.executie_proiecte?.nume||'fără proiect'}
                </option>
              ))}
            </select>
          </div>
        )}

        {sursaCalc === 'salvat' && calc && (
          <div style={{background:G.bg, borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:12, color:G.muted, display:'flex', gap:18, flexWrap:'wrap'}}>
            <span>Durată totală: <strong style={{color:G.text}}>{fmtH(calc.durata_total_h)}</strong></span>
            <span>Consum: <strong style={{color:G.orange}}>{fmtLei(calc.consum_motorina_l)} L</strong></span>
            <span>Config: <strong style={{color:G.text}}>{calc.probe_configuratii?.denumire||'—'}</strong></span>
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>
          <div><label style={S.lbl}>Client</label><input value={f.client} onChange={e=>setK('client',e.target.value)} style={S.input} placeholder="ex: Habau" /></div>
          <div><label style={S.lbl}>Localitate</label><input value={f.localitate} onChange={e=>setK('localitate',e.target.value)} style={S.input} /></div>
          <div><label style={S.lbl}>Distanță (km)</label><input type="number" value={f.distanta_km} onChange={e=>setK('distanta_km',e.target.value)} style={S.input} /></div>
          <div><label style={S.lbl}>Data ofertei</label><input type="date" value={f.data_oferta} onChange={e=>setK('data_oferta',e.target.value)} style={S.input} /></div>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
          <div style={{fontSize:12, fontWeight:800, color:G.text}}>💰 Costuri (lei, fără TVA)</div>
          <div style={{flex:1}} />
          {(() => {
            const cat = sursaCalc==='nou' ? ciCfg?.categorie_transport : calcSalvat?.probe_configuratii?.categorie_transport
            const t = cat ? tarifTransport(cat) : null
            if (!t) return null
            return (
              <span style={{fontSize:11, color:G.muted}}>
                🚚 {cat} ({t.denumire}): <strong style={{color:G.ofertare}}>{fmtLei(t.tarif_lei_km)} lei/km</strong>{t.dus_intors?' ×2 dus-întors':''}
                {f.distanta_km ? <span> → <strong style={{color:G.green}}>{fmtLei(calcTransport(cat, f.distanta_km))} lei</strong></span> : ''}
              </span>
            )
          })()}
          <button onClick={()=>setShowTarife(true)} style={{...S.btnS, padding:'4px 10px', fontSize:11}}>⚙️ Tarife</button>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14}}>
          {/* Transport (fără checkbox) */}
          <div><label style={S.lbl}>🚚 Transport</label>
            <input type="number" value={f.transport_lei} onChange={e=>setK('transport_lei',e.target.value)} style={{...S.input, color:G.blue}} /></div>
          {/* Stat dispoziție */}
          <div><label style={S.lbl}>⏸️ Stat dispoziție</label>
            <input type="number" value={f.stat_dispozitie_lei} onChange={e=>setK('stat_dispozitie_lei',e.target.value)} style={{...S.input, color:G.blue}} /></div>

          {/* Pistonare / Uscare / Calibrare — cu checkbox include/exclude */}
          {[['pistonare','🔧 Pistonare'],['uscare','💨 Uscare'],['calibrare','🎯 Calibrare']].map(([base,lbl])=>{
            const incK = 'inc_'+base, valK = base+'_lei', on = f[incK]
            return (
              <div key={base}>
                <label style={{...S.lbl, display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                  <input type="checkbox" checked={on} onChange={e=>setK(incK, e.target.checked)} style={{margin:0}} />
                  {lbl} {!on && <span style={{color:G.dim, fontWeight:400, textTransform:'none'}}>(exclus)</span>}
                </label>
                <input type="number" value={f[valK]} onChange={e=>setK(valK,e.target.value)} disabled={!on}
                  style={{...S.input, color: on?G.blue:G.dim, opacity: on?1:0.45}} />
              </div>
            )
          })}

          {/* Probă presiune + discount */}
          <div style={{gridColumn:'1 / -1'}}>
            {pretPropusActiv?.aplicabil && (
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap',
                background: pretPropusActiv.sub_prag ? G.orange+'18' : G.green+'14',
                border:`1px solid ${pretPropusActiv.sub_prag ? G.orange : G.green}55`, borderRadius:8, padding:'8px 12px', marginBottom:8}}>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                  <span style={{fontSize:12, fontWeight:700, color: pretPropusActiv.sub_prag ? G.orange : G.green}}>
                    💡 Preț propus spre ofertare: {fmtLei(pretPropusActiv.pret_final)} lei
                  </span>
                  <span style={{fontSize:10, color:G.dim}}>
                    referință LMF {fmtLei(pretPropusActiv.pret_referinta)} lei
                    {pretPropusActiv.spor>0 && ` · spor +${pretPropusActiv.spor}% → ${fmtLei(pretPropusActiv.pret_cu_spor)} lei`}
                    {pretPropusActiv.sub_prag && ` · ⚠️ sub prag, ridicat la ${fmtLei(PRAG_MINIM_PROBA_LEI)} lei`}
                  </span>
                </div>
                <button onClick={folosestePretPropus} style={{padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer',
                  background: pretPropusActiv.sub_prag ? G.orange : G.green, color:'#fff', fontWeight:700, fontSize:12, whiteSpace:'nowrap'}}>
                  ↧ folosește
                </button>
              </div>
            )}
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div><label style={S.lbl}>🧪 Probă presiune</label>
                <input type="number" value={f.proba_lei} onChange={e=>setK('proba_lei',e.target.value)} style={{...S.input, color:G.blue}} /></div>
              <div><label style={S.lbl}>🏷️ Discount probă (%)</label>
                <input type="number" value={f.discount_pct} onChange={e=>setK('discount_pct',e.target.value)} style={{...S.input, color:G.orange}} placeholder="0" />
                {discountProba>0 && <div style={{fontSize:10, color:G.orange, marginTop:3}}>−{fmtLei(discountProba)} lei din probă</div>}
              </div>
            </div>
          </div>

          {/* Extra */}
          <div><label style={S.lbl}>➕ Extra</label>
            <input type="number" value={f.extra_lei} onChange={e=>setK('extra_lei',e.target.value)} style={{...S.input, color:G.blue}} /></div>
        </div>

        <div style={{background:G.bg, borderRadius:8, padding:'12px 16px', marginBottom:14, display:'flex', flexDirection:'column', gap:6}}>
          {discountProba>0 && (
            <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}><span style={{color:G.orange}}>🏷️ Discount probă {fmtLei(f.discount_pct)}%</span><strong style={{color:G.orange, fontFamily:'monospace'}}>−{fmtLei(discountProba)} lei</strong></div>
          )}
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13}}><span style={{color:G.muted}}>Total fără TVA</span><strong style={{color:G.text, fontFamily:'monospace'}}>{fmtLei(totalFaraTva)} lei</strong></div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:13}}><span style={{color:G.muted}}>TVA {TVA_OFERTA}%</span><strong style={{color:G.yellow, fontFamily:'monospace'}}>{fmtLei(tva)} lei</strong></div>
          <div style={{height:1, background:G.border, margin:'2px 0'}} />
          <div style={{display:'flex', justifyContent:'space-between', fontSize:15}}><span style={{fontWeight:800}}>TOTAL CU TVA</span><strong style={{color:G.green, fontFamily:'monospace', fontWeight:800}}>{fmtLei(totalCuTva)} lei</strong></div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>
          <div><label style={S.lbl}>Status</label>
            <select value={f.status} onChange={e=>setK('status',e.target.value)} style={S.input}>
              {Object.entries(OFERTA_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select></div>
          <div><label style={S.lbl}>Observații</label><input value={f.observatii} onChange={e=>setK('observatii',e.target.value)} style={S.input} /></div>
        </div>

        <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap'}}>
          <button onClick={handleExcel} disabled={!calc||exporting} style={{...S.btnS, opacity:(!calc||exporting)?0.5:1, flex:1}}>📥 Export Excel</button>
          <button onClick={handlePDF} disabled={!calc||exporting} style={{...S.btnS, opacity:(!calc||exporting)?0.5:1, flex:1}}>📄 Export PDF</button>
        </div>

        <div style={{display:'flex', gap:10}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={save} disabled={busy} style={{...S.btnP, flex:2, opacity:busy?0.6:1}}>{busy?'Se salvează...':'💾 Salvează ofertă'}</button>
        </div>

        {showTarife && (
          <TarifeTransportModal tarife={transportTarife}
            onClose={()=>setShowTarife(false)}
            onSaved={(noi)=>{ setTransportTarife(noi); setShowTarife(false) }} />
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL TARIFE TRANSPORT (editabil din UI)
// ════════════════════════════════════════════════════════════════
function TarifeTransportModal({ tarife, onClose, onSaved }) {
  const [rows, setRows] = useState(tarife.map(t => ({...t})))
  const [saving, setSaving] = useState(false)
  const setVal = (cat, k, v) => setRows(rs => rs.map(r => r.categorie===cat ? {...r,[k]:v} : r))

  const save = async () => {
    setSaving(true)
    for (const r of rows) {
      await supabase.from('probe_transport_tarife').update({
        tarif_lei_km: Number(r.tarif_lei_km)||0, dus_intors: !!r.dus_intors, denumire: r.denumire, updated_at: new Date().toISOString(),
      }).eq('categorie', r.categorie)
    }
    setSaving(false)
    onSaved(rows)
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:10002, padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:G.surface, border:`1px solid ${G.border}`, borderRadius:12, padding:24, width:'100%', maxWidth:460}}>
        <h3 style={{margin:'0 0 4px', fontSize:16, color:G.text}}>⚙️ Tarife transport</h3>
        <div style={{fontSize:11, color:G.muted, marginBottom:16}}>lei/km · categoria se setează pe fiecare configurație de utilaj</div>
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          {rows.map(r => (
            <div key={r.categorie} style={{background:G.bg, borderRadius:8, padding:'12px 14px'}}>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
                <span style={{background:G.ofertare+'22', color:G.ofertare, borderRadius:6, padding:'3px 10px', fontSize:13, fontWeight:800}}>{r.categorie}</span>
                <input value={r.denumire} onChange={e=>setVal(r.categorie,'denumire',e.target.value)} style={{...S.input, flex:1}} />
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12, alignItems:'end'}}>
                <div><label style={S.lbl}>Tarif (lei/km)</label>
                  <input type="number" value={r.tarif_lei_km} onChange={e=>setVal(r.categorie,'tarif_lei_km',e.target.value)} style={{...S.input, color:G.blue}} /></div>
                <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:G.muted, paddingBottom:9, cursor:'pointer'}}>
                  <input type="checkbox" checked={!!r.dus_intors} onChange={e=>setVal(r.categorie,'dus_intors',e.target.checked)} /> dus-întors (×2)
                </label>
              </div>
            </div>
          ))}
        </div>
        <div style={{display:'flex', gap:10, marginTop:18}}>
          <button onClick={onClose} style={{...S.btnS, flex:1}}>Anulează</button>
          <button onClick={save} disabled={saving} style={{...S.btnP, flex:1, opacity:saving?0.6:1}}>{saving?'...':'💾 Salvează tarife'}</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// EXPORT EXCEL — xlsx-js-style
// ════════════════════════════════════════════════════════════════
async function generateOfertaExcel(d) {
  const XLSX = await import('xlsx-js-style')
  const calc = d.calc || {}
  const dn = calc.probe_diametre?.dn_label || '—'
  const cfg = calc.probe_configuratii?.denumire || '—'

  const bBold = { font:{ bold:true } }
  const bHdr = { font:{ bold:true, color:{rgb:'FFFFFF'} }, fill:{ fgColor:{rgb:'3B6D11'} }, alignment:{horizontal:'center'} }
  const bNum = { alignment:{horizontal:'right'}, numFmt:'#,##0.00' }
  const bEdit = { font:{ color:{rgb:'1F6FEB'} }, alignment:{horizontal:'right'}, numFmt:'#,##0.00' }
  const bTotal = { font:{ bold:true, color:{rgb:'FFFFFF'} }, fill:{ fgColor:{rgb:'238636'} }, alignment:{horizontal:'right'}, numFmt:'#,##0.00' }

  const rows = [
    [{v:'GAZPET INSTAL SRL', s:{font:{bold:true,sz:16}}}],
    [{v:'Ofertă prestări servicii — Probe de presiune', s:{font:{bold:true,sz:12}}}],
    [{v:`Nr. ${d.nr_oferta}   ·   Data: ${d.data_oferta}`, s:{font:{italic:true}}}],
    [],
    [{v:'Client', s:bBold}, {v:d.client||'—'}],
    [{v:'Localitate', s:bBold}, {v:d.localitate||'—'}],
    [{v:'Distanță (km)', s:bBold}, {v:d.distanta_km||'—'}],
    [],
    [{v:'PARAMETRI TEHNICI', s:bHdr}, {v:'', s:bHdr}],
    [{v:'Tip fluid'}, {v:calc.tip_fluid==='apa'?'Hidraulic (apă)':'Pneumatic (aer)'}],
    [{v:'Diametru'}, {v:dn}],
    [{v:'Lungime (m)'}, {v:Number(calc.lungime_m)||0, s:bNum}],
    [{v:'Presiune (bar)'}, {v:Number(calc.presiune_bar)||0, s:bNum}],
    [{v:'Durată totală (h)'}, {v:Number(calc.durata_total_h)||0, s:bNum}],
    [{v:'Configurație'}, {v:cfg}],
    [],
    [{v:'DETALIERE COSTURI', s:bHdr}, {v:'Valoare (lei)', s:bHdr}],
    [{v:'Transport'}, {v:Number(d.transport_lei)||0, s:bEdit}],
    ...(d.inc_pistonare ? [[{v:'Pistonare'}, {v:Number(d.pistonare_lei)||0, s:bNum}]] : []),
    ...(d.inc_uscare    ? [[{v:'Uscare'}, {v:Number(d.uscare_lei)||0, s:bNum}]] : []),
    ...(d.inc_calibrare ? [[{v:'Calibrare'}, {v:Number(d.calibrare_lei)||0, s:bNum}]] : []),
    [{v:'Probă presiune'}, {v:Number(d.proba_lei)||0, s:bNum}],
    ...(d.discountProba>0 ? [[{v:`Discount probă ${Number(d.discount_pct)||0}%`, s:{font:{color:{rgb:'C2410C'}}}}, {v:-d.discountProba, s:{...bNum,font:{color:{rgb:'C2410C'}}}}]] : []),
    [{v:'Stat dispoziție'}, {v:Number(d.stat_dispozitie_lei)||0, s:bEdit}],
    [{v:'Extra'}, {v:Number(d.extra_lei)||0, s:bEdit}],
    [{v:'Total fără TVA', s:bBold}, {v:d.totalFaraTva, s:{...bNum,font:{bold:true}}}],
    [{v:`TVA ${TVA_OFERTA}%`, s:bBold}, {v:d.tva, s:bNum}],
    [{v:'TOTAL CU TVA', s:{font:{bold:true}}}, {v:d.totalCuTva, s:bTotal}],
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{wch:28},{wch:22}]
  ws['!merges'] = [ {s:{r:8,c:0},e:{r:8,c:1}}, {s:{r:16,c:0},e:{r:16,c:1}} ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ofertă')
  const clientClean = (d.client||'CLIENT').replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,12)
  const dataClean = (d.data_oferta||'').replace(/-/g,'')
  XLSX.writeFile(wb, `Oferta_${d.nr_oferta}_${clientClean}_${dataClean}.xlsx`)
}

// ════════════════════════════════════════════════════════════════
// EXPORT PDF — html2canvas + jsPDF (A4 portrait)
// ════════════════════════════════════════════════════════════════
async function generateOfertaPDF(d) {
  const { jsPDF } = await import('jspdf')
  const html2canvas = (await import('html2canvas')).default
  const calc = d.calc || {}
  const dn = calc.probe_diametre?.dn_label || '—'
  const cfg = calc.probe_configuratii?.denumire || '—'
  const fluidLbl = calc.tip_fluid==='apa'?'Hidraulic (apă)':'Pneumatic (aer)'

  const row = (l,v) => `<tr><td style="padding:5px 10px;color:#555;border-bottom:1px solid #eee">${l}</td><td style="padding:5px 10px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${v}</td></tr>`
  const costRow = (l,v) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${l}</td><td style="padding:6px 12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee">${fmtLei(v)} lei</td></tr>`

  const html = `
  <div style="width:794px;padding:36px 40px;font-family:Arial,sans-serif;color:#1a1a1a;box-sizing:border-box;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #3B6D11;padding-bottom:14px;margin-bottom:20px">
      <div><div style="font-size:22px;font-weight:bold;color:#3B6D11">GAZPET INSTAL SRL</div>
        <div style="font-size:11px;color:#777">Probe de presiune · prestări servicii</div></div>
      <div style="text-align:right"><div style="font-size:18px;font-weight:bold">OFERTĂ ${d.nr_oferta}</div>
        <div style="font-size:12px;color:#555">Data: ${d.data_oferta}</div></div>
    </div>
    <table style="width:100%;font-size:12px;margin-bottom:16px"><tbody>
      ${row('Client', d.client||'—')}${row('Localitate', d.localitate||'—')}${row('Distanță', (d.distanta_km||'—')+' km')}
    </tbody></table>
    <div style="font-size:13px;font-weight:bold;color:#3B6D11;margin:6px 0 6px">Parametri tehnici</div>
    <table style="width:100%;font-size:12px;margin-bottom:16px"><tbody>
      ${row('Tip fluid', fluidLbl)}${row('Diametru', dn)}${row('Lungime', fmtLei(calc.lungime_m)+' m')}
      ${row('Presiune probă', fmtLei(calc.presiune_bar)+' bar')}${row('Durată estimată', fmtH(calc.durata_total_h))}${row('Configurație echipament', cfg)}
    </tbody></table>
    <div style="font-size:13px;font-weight:bold;color:#3B6D11;margin:6px 0 6px">Detaliere costuri</div>
    <table style="width:100%;font-size:12px;border:1px solid #eee;margin-bottom:6px"><tbody>
      ${costRow('Transport', d.transport_lei)}
      ${d.inc_pistonare?costRow('Pistonare', d.pistonare_lei):''}${d.inc_uscare?costRow('Uscare', d.uscare_lei):''}${d.inc_calibrare?costRow('Calibrare', d.calibrare_lei):''}
      ${costRow('Probă presiune', d.proba_lei)}
      ${d.discountProba>0?`<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#c2410c">Discount probă ${Number(d.discount_pct)||0}%</td><td style="padding:6px 12px;text-align:right;font-family:monospace;border-bottom:1px solid #eee;color:#c2410c">−${fmtLei(d.discountProba)} lei</td></tr>`:''}
      ${costRow('Stat dispoziție', d.stat_dispozitie_lei)}
      ${Number(d.extra_lei)>0?costRow('Extra', d.extra_lei):''}
    </tbody></table>
    <table style="width:100%;font-size:12px;margin-bottom:18px"><tbody>
      <tr><td style="padding:5px 12px;text-align:right;color:#555">Total fără TVA:</td><td style="padding:5px 12px;text-align:right;font-family:monospace;width:140px">${fmtLei(d.totalFaraTva)} lei</td></tr>
      <tr><td style="padding:5px 12px;text-align:right;color:#555">TVA ${TVA_OFERTA}%:</td><td style="padding:5px 12px;text-align:right;font-family:monospace">${fmtLei(d.tva)} lei</td></tr>
      <tr><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:14px">TOTAL CU TVA:</td><td style="padding:8px 12px;text-align:right;font-family:monospace;font-weight:bold;font-size:14px;background:#e8f5e0;color:#236d11">${fmtLei(d.totalCuTva)} lei</td></tr>
    </tbody></table>
    <div style="font-size:11px;color:#999;font-style:italic;margin-bottom:24px">Ofertă valabilă 30 zile de la data emiterii. Estimare fără pauze de odihnă oameni/utilaje.</div>
    <div style="display:flex;justify-content:space-between;margin-top:30px">
      <div style="text-align:center;width:45%"><div style="font-size:11px;color:#777;margin-bottom:40px">SE APROBĂ</div><div style="border-top:1px solid #999;padding-top:4px;font-size:12px">Trusu Răzvan — Director</div></div>
      <div style="text-align:center;width:45%"><div style="font-size:11px;color:#777;margin-bottom:40px">ÎNTOCMIT</div><div style="border-top:1px solid #999;padding-top:4px;font-size:12px">${d.intocmit||'—'}</div></div>
    </div>
    <div style="margin-top:20px;font-size:9px;color:#bbb;text-align:right">Generat ${new Date().toLocaleString('ro-RO')}</div>
  </div>`

  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff'
  div.innerHTML = html
  document.body.appendChild(div)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const canvas = await html2canvas(div, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
  document.body.removeChild(div)
  const imgData = canvas.toDataURL('image/jpeg', 0.92)
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
  const W=210, H=Math.min(297, (canvas.height/canvas.width)*210)
  doc.addImage(imgData,'JPEG',0,0,W,H,'','FAST')
  const clientClean = (d.client||'CLIENT').replace(/[^a-zA-Z0-9]/g,'').toUpperCase().slice(0,12)
  const dataClean = (d.data_oferta||'').replace(/-/g,'')
  doc.save(`Oferta_${d.nr_oferta}_${clientClean}_${dataClean}.pdf`)
}
