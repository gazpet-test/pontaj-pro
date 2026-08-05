// ===========================================================================
// MODUL EXECUȚIE — Dashboard Proiecte + Context Proiect
// ===========================================================================
// 20.05.2026 — FAZA 1: sub-tab shell
// 02.06.2026 — FAZA A+B+C: dashboard proiecte, alocare personal, utilaje tură
// 03.06.2026 — REFACTOR NAVIGARE: context per proiect
//   • /executie              → Dashboard proiecte (carduri click-to-open)
//   • /executie?proiect=X    → Context proiect (breadcrumb + sub-tab-uri)
//   • /executie?proiect=X&tab=santiere|tronsoane|situatii_plata|izometrie|documente
// 03.06.2026 — ProiectEditModal: nr_contract, data_contract, Ordin de începere
//              Secțiune „Documente anexă la contract" cu upload/download
//              Tabel executie_documente_contract + bucket executie-contracte
// ===========================================================================

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import IzometriePage from './Izometrie.jsx'
import TabSantiere, { NavetaTura } from './TabSantiere.jsx'
import TabTronsoane from './TabTronsoane.jsx'
import TabSituatiiPlata from './TabSituatiiPlata.jsx'
import TabDocumenteNAS from './TabDocumenteNAS.jsx'
import CereriInterneProiect from './CereriInterneProiect.jsx'
import { norm } from './lib/diacritice.js'
import ConsumuriBonuriTab from './ConsumuriBonuriTab.jsx'
import CitesteOricePanel from './CitesteOricePanel.jsx'
import CatalogDevizPanel from './CatalogDevizPanel.jsx'
import ActivitatiProiectPanel from './ActivitatiProiectPanel.jsx'
import MaterialeProiectPanel from './MaterialeProiectPanel.jsx'
import UnitatiProiectPanel from './UnitatiProiectPanel.jsx'
import { createClient } from '@supabase/supabase-js'

import { instrumenteazaStorageRls } from './lib/storageRls.js'

const supabase = instrumenteazaStorageRls(createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
))

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', teal:'#2DD4BF', pink:'#F778BA',
  executie:'#58A6FF',
}

const fmtM = v => {
  if (!v) return '—'
  const km = parseFloat(v) / 1000
  return km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(parseFloat(v))} m`
}
const fmtLei = v => {
  if (!v) return '—'
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON', maximumFractionDigits: 0 }).format(v)
}
const fmtDate = v => {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Tab-uri contextuale (apar doar când e selectat un proiect)
// ---------------------------------------------------------------------------
const CONTEXT_TABS = [
  { key: 'proiect',        label: 'Proiect',        icon: '📊', color: G.green,  desc: 'Dashboard · Echipă · ISC · Stadiu' },
  { key: 'santiere',       label: 'Șantiere',       icon: '🏗️', color: G.blue,   desc: 'Personal tură · Utilaje' },
  { key: 'situatii_plata', label: 'Situații plată', icon: '💰', color: G.orange, desc: 'SL1–SL6 · NCS · Facturare' },
  { key: 'cereri',         label: 'Cereri interne', icon: '📋', color: G.pink,   desc: 'Materiale · Achiziții · PDF' },
  { key: 'consumuri',      label: 'Consumuri',      icon: '🧾', color: G.orange, desc: 'Bonuri consum materiale · SL' },
  { key: 'izometrie',      label: 'Izometrie',      icon: '📐', color: G.purple, desc: 'Pachete lansare · Tronsoane · Cumulat' },
  { key: 'documente',      label: 'Documente',      icon: '📂', color: G.muted,  desc: 'Calitate materiale · Arhivă NAS' },
]

// ===========================================================================
// MAIN COMPONENT — ExecutiePage (shell cu navigare proiect în URL)
// ===========================================================================
export default function ExecutiePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const proiectIdStr = searchParams.get('proiect') // null sau '1','2',...
  const tabStr = searchParams.get('tab') || 'proiect'

  // Profil curent + panel „Citește Orice"
  const [profile, setProfile] = useState(null)
  const [citesteOpen, setCitesteOpen] = useState(false)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role,can_manage_contracts').eq('id', user.id).single()
        setProfile(prof)
      }
    })()
  }, [])

  // Navighează la contextul unui proiect
  const goToProiect = (id, tab = 'proiect') => {
    setSearchParams({ proiect: String(id), tab }, { replace: false })
  }
  // Revine la dashboard
  const goBack = () => setSearchParams({}, { replace: false })
  // Schimbă tab-ul în contextul curent
  const changeTab = (tab) => setSearchParams({ proiect: proiectIdStr, tab }, { replace: true })

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>

      {/* ─── NAV BAR STICKY ─── */}
      <div style={{
        position: 'sticky', top: 60, zIndex: 50,
        background: G.surface, borderBottom: `1px solid ${G.border}`,
        padding: '0 28px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>

          {/* Logo modul */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            paddingRight: 18, marginRight: 6,
            borderRight: `1px solid ${G.border}`,
            height: 52, flexShrink: 0,
          }}>
            <div style={{
              width: 32, height: 32,
              background: `linear-gradient(135deg, ${G.executie}, #1F6FEB)`,
              borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>🏗️</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.2px' }}>Execuție</div>
              <div style={{ fontSize: 10, color: G.muted, marginTop: -1 }}>Proiecte operaționale</div>
            </div>
          </div>

          {/* Buton Proiecte (nivelul 1 — mereu vizibil) */}
          <button
            onClick={goBack}
            title="Toate proiectele"
            style={{
              padding: '14px 16px', background: 'transparent', border: 'none',
              borderBottom: `2px solid ${!proiectIdStr ? G.executie : 'transparent'}`,
              color: !proiectIdStr ? G.executie : G.text,
              cursor: 'pointer', fontSize: 13,
              fontWeight: !proiectIdStr ? 700 : 500,
              transition: 'all .15s ease',
              display: 'flex', alignItems: 'center', gap: 7,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
            onMouseEnter={e => { if (proiectIdStr) e.currentTarget.style.color = G.executie }}
            onMouseLeave={e => { if (proiectIdStr) e.currentTarget.style.color = G.text }}
          >
            <span style={{ fontSize: 16 }}>🗂️</span> Proiecte
          </button>

          {/* Separator + tab-uri contextuale (doar când proiect selectat) */}
          {proiectIdStr && <>
            <span style={{ color: G.border, fontSize: 20, marginInline: 2, flexShrink: 0 }}>›</span>

            {CONTEXT_TABS.map(t => {
              const isActive = tabStr === t.key || (t.key === 'izometrie' && tabStr === 'tronsoane')
              return (
                <button
                  key={t.key}
                  onClick={() => changeTab(t.key)}
                  title={t.desc}
                  style={{
                    padding: '14px 16px', background: 'transparent', border: 'none',
                    borderBottom: `2px solid ${isActive ? t.color : 'transparent'}`,
                    color: isActive ? t.color : G.text,
                    cursor: 'pointer', fontSize: 13,
                    fontWeight: isActive ? 700 : 500,
                    transition: 'all .15s ease',
                    display: 'flex', alignItems: 'center', gap: 7,
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = t.color }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = G.text }}
                >
                  <span style={{ fontSize: 15 }}>{t.icon}</span>
                  {t.label}
                </button>
              )
            })}
          </>}

          {/* Citește Orice — AI Document Router (dreapta) */}
          {profile && (
            <button
              onClick={() => setCitesteOpen(true)}
              title="Încarcă orice document — AI îl citește și îl pregătește pentru confirmare"
              style={{
                marginLeft: 'auto', flexShrink: 0,
                padding: '8px 14px', background: G.executie + '18',
                border: `1px solid ${G.executie}55`, borderRadius: 8,
                color: G.executie, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = G.executie + '2A' }}
              onMouseLeave={e => { e.currentTarget.style.background = G.executie + '18' }}
            >
              <span style={{ fontSize: 15 }}>📥</span> Citește Orice
            </button>
          )}
        </div>
      </div>

      {/* ─── CONTENT ─── */}
      {!proiectIdStr ? (
        <DashboardProiectePage onSelectProiect={goToProiect} />
      ) : (
        <ProiectContextView
          proiectId={proiectIdStr}
          tab={tabStr}
          onBack={goBack}
        />
      )}

      {/* ─── Citește Orice (AI Document Router) ─── */}
      <CitesteOricePanel
        open={citesteOpen}
        onClose={() => setCitesteOpen(false)}
        profile={profile}
      />
    </div>
  )
}

// ===========================================================================
// CONTEXT VIEW — banner proiect + renderează tab-ul cu proiectId prop
// ===========================================================================
function ProiectContextView({ proiectId, tab, onBack }) {
  const [proiect, setProiect] = useState(null)
  // Sub-tab izometrie: 'izometrie' | 'tronsoane'
  // Dacă vine cu tab=tronsoane (link vechi), auto-selectăm sub-tab tronsoane
  const [izSubTab, setIzSubTab] = useState(tab === 'tronsoane' ? 'tronsoane' : 'izometrie')

  useEffect(() => {
    supabase.from('v_executie_dashboard')
      .select('*').eq('id', proiectId).single()
      .then(({ data }) => setProiect(data))
  }, [proiectId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Breadcrumb / info banner proiect */}
      <div style={{
        background: G.executie + '0C', borderBottom: `1px solid ${G.executie}20`,
        padding: '8px 28px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: `1px solid ${G.border}`, borderRadius: 6,
          color: G.muted, cursor: 'pointer', fontSize: 12, padding: '4px 10px',
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
        }}>← Proiecte</button>

        <span style={{ color: G.border }}>|</span>

        {proiect ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: 11, color: G.executie, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' }}>
              {proiect.cod_intern}
            </span>
            <span style={{ color: G.border }}>·</span>
            <span style={{ fontSize: 12, color: G.text }}>{proiect.nume?.slice(0, 80)}</span>
            {proiect.site_name && (
              <>
                <span style={{ color: G.border }}>·</span>
                <span style={{ fontSize: 11, color: G.muted }}>📍 {proiect.site_name}</span>
              </>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: G.muted }}>Se încarcă...</span>
        )}

        {/* Badge termen */}
        {proiect?.data_termen && (
          <div style={{
            marginLeft: 'auto', fontSize: 11, padding: '3px 10px',
            borderRadius: 6, fontWeight: 700, flexShrink: 0,
            background: (
              proiect.zile_pana_termen < 0 ? G.red :
              proiect.zile_pana_termen <= 30 ? G.red :
              proiect.zile_pana_termen <= 90 ? G.yellow : G.green
            ) + '22',
            color: (
              proiect.zile_pana_termen < 0 ? G.red :
              proiect.zile_pana_termen <= 30 ? G.red :
              proiect.zile_pana_termen <= 90 ? G.yellow : G.green
            ),
          }}>
            📅 {fmtDate(proiect.data_termen)}
            {proiect.zile_pana_termen !== null && (
              <span style={{ marginLeft: 6 }}>
                {proiect.zile_pana_termen >= 0
                  ? `· ${proiect.zile_pana_termen}z rămase`
                  : `· depășit ${Math.abs(proiect.zile_pana_termen)}z`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tab content cu proiectId prop */}
      {tab === 'proiect'        && <TabProiectDashboard proiectId={proiectId} />}
      {tab === 'santiere'       && <TabSantiere      proiectId={proiectId} />}
      {tab === 'situatii_plata' && <TabSituatiiPlata proiectId={proiectId} />}
      {tab === 'cereri'         && <CereriInterneProiect proiectId={proiectId} />}
      {tab === 'consumuri'      && <ConsumuriBonuriTab proiectId={proiectId} mode="executie" />}
      {tab === 'documente'      && (<><DocCalitateMaterialeSection proiectId={proiectId} /><TabDocumenteNAS proiectId={proiectId} /></>)}

      {/* ── Izometrie + Tronsoane (sub-tabs) ── */}
      {(tab === 'izometrie' || tab === 'tronsoane') && (
        <div>
          {/* Sub-tab bar */}
          <div style={{
            display:'flex', gap:0, borderBottom:`1px solid ${G.border}`,
            background:G.surface, paddingLeft:28,
          }}>
            {[
              {key:'izometrie', label:'📐 Izometrie',  desc:'Pachete · Lansare · Cumulat'},
              {key:'tronsoane', label:'📍 Tronsoane',   desc:'Program · Status · Suduri'},
            ].map(st => {
              const active = izSubTab === st.key
              return (
                <button key={st.key} onClick={()=>setIzSubTab(st.key)} title={st.desc} style={{
                  padding:'10px 18px', background:'transparent', border:'none',
                  borderBottom:`2px solid ${active ? G.purple : 'transparent'}`,
                  color: active ? G.purple : G.muted,
                  cursor:'pointer', fontSize:12, fontWeight: active ? 700 : 500,
                  transition:'all .15s',
                }}>
                  {st.label}
                </button>
              )
            })}
          </div>
          {/* Content */}
          {izSubTab === 'izometrie' && <IzometriePage initialProiectId={Number(proiectId)} />}
          {izSubTab === 'tronsoane' && <TabTronsoane  proiectId={proiectId} />}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// DASHBOARD PROIECTE — Tab principal (carduri cu click-to-open)
// ===========================================================================
function DashboardProiectePage({ onSelectProiect }) {
  const [proiecte, setProiecte] = useState([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [selectedProiect, setSelectedProiect] = useState(null)
  const [editProiect, setEditProiect] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role,can_manage_contracts').eq('id', user.id).single()
        setProfile(prof)
      }
      const { data, error } = await supabase.from('v_executie_dashboard').select('*').order('id')
      if (error) throw error
      setProiecte(data || [])
    } catch(e) {
      showToast('Eroare la încărcare: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  const isOwner = profile?.is_owner === true
  const canEdit = isOwner || profile?.can_manage_contracts === true
  const [alertFilter, setAlertFilter] = useState(null)
  const [cautaProiect, setCautaProiect] = useState('')

  const kpiAlerte = useMemo(() => {
    const cuTermen = proiecte.filter(p => p.activ && p.data_termen && p.zile_pana_termen !== null)
    return {
      total:   proiecte.length,
      active:  proiecte.filter(p => p.activ).length,
      depasit: cuTermen.filter(p => p.zile_pana_termen < 0),
      critic:  cuTermen.filter(p => p.zile_pana_termen >= 0 && p.zile_pana_termen < 30),
      atentie: cuTermen.filter(p => p.zile_pana_termen >= 30 && p.zile_pana_termen <= 60),
      fara_contract: proiecte.filter(p => p.activ && !p.are_contract),
      fara_date:     proiecte.filter(p => p.activ && !p.are_date),
    }
  }, [proiecte])

  const proiecteVizibile = useMemo(() => {
    let list = proiecte
    if (alertFilter === 'depasit')            list = kpiAlerte.depasit
    else if (alertFilter === 'critic')        list = kpiAlerte.critic
    else if (alertFilter === 'atentie')       list = kpiAlerte.atentie
    else if (alertFilter === 'fara_contract') list = kpiAlerte.fara_contract
    else if (alertFilter === 'fara_date')     list = kpiAlerte.fara_date
    if (cautaProiect.trim()) {
      const s = norm(cautaProiect)   // căutare fără diacritice
      list = list.filter(p =>
        norm(p.nume).includes(s) || norm(p.beneficiar).includes(s) ||
        norm(p.cod_intern).includes(s) || norm(p.beneficiar_final).includes(s) ||
        norm(p.nr_contract).includes(s)
      )
    }
    return list
  }, [proiecte, alertFilter, kpiAlerte, cautaProiect])

  // Proiecte cu probleme de configurare (pentru banner)
  const proiecteIncomplete = useMemo(
    () => proiecte.filter(p => p.activ && p.nr_probleme > 0),
    [proiecte]
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 80, right: 24, zIndex: 9999,
          padding: '12px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          background: toast.type === 'error' ? G.red : toast.type === 'success' ? G.greenBg : G.blue,
          color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.5)',
        }}>{toast.msg}</div>
      )}

      {/* Banner sănătate configurare */}
      {proiecteIncomplete.length > 0 && !alertFilter && (
        <div style={{
          background: G.orange + '0D', border: `1px solid ${G.orange}44`,
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.orange }}>
                {proiecteIncomplete.length} proiect{proiecteIncomplete.length > 1 ? 'e' : ''} cu configurare incompletă
              </div>
              <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
                {kpiAlerte.fara_contract?.length > 0 && `${kpiAlerte.fara_contract.length} fără contract`}
                {kpiAlerte.fara_contract?.length > 0 && kpiAlerte.fara_date?.length > 0 && ' · '}
                {kpiAlerte.fara_date?.length > 0 && `${kpiAlerte.fara_date.length} fără termene`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {kpiAlerte.fara_contract?.length > 0 && (
              <button onClick={() => setAlertFilter('fara_contract')} style={{
                padding: '5px 12px', background: G.orange + '22', border: `1px solid ${G.orange}55`,
                borderRadius: 7, color: G.orange, fontSize: 11, cursor: 'pointer', fontWeight: 700,
              }}>⚠️ {kpiAlerte.fara_contract.length} fără contract</button>
            )}
            {kpiAlerte.fara_date?.length > 0 && (
              <button onClick={() => setAlertFilter('fara_date')} style={{
                padding: '5px 12px', background: G.yellow + '22', border: `1px solid ${G.yellow}55`,
                borderRadius: 7, color: G.yellow, fontSize: 11, cursor: 'pointer', fontWeight: 700,
              }}>📅 {kpiAlerte.fara_date.length} fără termene</button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: G.text }}>🗂️ Dashboard Proiecte</h2>
          <div style={{ color: G.muted, fontSize: 13, marginTop: 4 }}>
            Monitorizare termene · Click pe proiect pentru a intra în context
          </div>
        </div>
        <input placeholder="🔍 Caută proiect / beneficiar / contract..." value={cautaProiect}
          onChange={e => setCautaProiect(e.target.value)}
          style={{ padding: '9px 14px', background: G.surface, border: `1px solid ${cautaProiect ? G.executie : G.border}`,
                   borderRadius: 8, color: G.text, fontSize: 13, width: 280, boxSizing: 'border-box' }} />
        {isOwner && (
          <button onClick={() => setEditProiect({ _isNew: true, activ: true })} style={{
            padding: '9px 18px', background: G.executie, border: 'none',
            borderRadius: 8, color: '#0D1117', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>＋ Proiect nou</button>
        )}
      </div>

      {/* KPI alerte — clickabile */}
      {(() => {
        const KPI = [
          { id: null,      label: 'Proiecte active',    value: `${kpiAlerte.active}/${kpiAlerte.total}`, icon: '📁', color: G.executie, count: 0 },
          { id: 'depasit', label: 'Termen depășit',     value: kpiAlerte.depasit.length, icon: '🔴', color: G.red,    count: kpiAlerte.depasit.length },
          { id: 'critic',  label: 'Critic (< 30 zile)', value: kpiAlerte.critic.length,  icon: '🟠', color: G.orange, count: kpiAlerte.critic.length  },
          { id: 'atentie', label: 'Atenție (30–60 zile)',value: kpiAlerte.atentie.length, icon: '🟡', color: G.yellow, count: kpiAlerte.atentie.length },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: alertFilter ? 12 : 28 }}>
            {KPI.map(kpi => {
              const isActive = alertFilter === kpi.id
              const clickable = kpi.id !== null && kpi.count > 0
              return (
                <div key={kpi.id || 'active'}
                  onClick={() => clickable && setAlertFilter(isActive ? null : kpi.id)}
                  style={{
                    background: isActive ? kpi.color + '1A' : G.surface,
                    border: `${isActive ? 2 : 1}px solid ${isActive ? kpi.color : kpi.count > 0 && kpi.id ? kpi.color + '55' : G.border}`,
                    borderRadius: 10, padding: '16px 18px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'all .15s ease', position: 'relative',
                  }}
                  onMouseEnter={e => { if (clickable && !isActive) e.currentTarget.style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { if (clickable) e.currentTarget.style.transform = 'none' }}
                >
                  {/* Dot pulsant pentru depășit */}
                  {kpi.id === 'depasit' && kpi.count > 0 && (
                    <div style={{
                      position: 'absolute', top: 10, right: 10,
                      width: 8, height: 8, borderRadius: '50%',
                      background: G.red, boxShadow: `0 0 0 3px ${G.red}44`,
                    }} />
                  )}
                  <div style={{
                    width: 40, height: 40, borderRadius: 9,
                    background: kpi.color + '22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, flexShrink: 0,
                  }}>{kpi.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: kpi.count > 0 && kpi.id ? kpi.color : kpi.id ? G.muted : kpi.color, lineHeight: 1 }}>{kpi.value}</div>
                    <div style={{ fontSize: 11, color: G.muted, marginTop: 3 }}>{kpi.label}</div>
                  </div>
                  {clickable && (
                    <div style={{ fontSize: 9, color: isActive ? kpi.color : G.dim, fontWeight: 700, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '.3px', lineHeight: 1.4 }}>
                      {isActive ? '✕ Reset' : '↗ Filtru'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Banner filtru activ */}
      {alertFilter && (
        <div style={{
          background: (alertFilter === 'depasit' ? G.red : alertFilter === 'critic' ? G.orange : G.yellow) + '12',
          border: `1px solid ${(alertFilter === 'depasit' ? G.red : alertFilter === 'critic' ? G.orange : G.yellow)}40`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: alertFilter === 'depasit' ? G.red : alertFilter === 'critic' ? G.orange : G.yellow }}>
            {alertFilter === 'depasit' && `🔴 ${kpiAlerte.depasit.length} proiecte cu termenul DEPĂȘIT`}
            {alertFilter === 'critic'  && `🟠 ${kpiAlerte.critic.length} proiecte CRITICE (mai puțin de 30 zile)`}
            {alertFilter === 'atentie' && `🟡 ${kpiAlerte.atentie.length} proiecte cu ATENȚIE (30–60 zile)`}
          </span>
          <button onClick={() => setAlertFilter(null)} style={{
            background: 'transparent', border: 'none', color: G.muted,
            cursor: 'pointer', fontSize: 16, padding: '0 4px',
          }}>✕ Toate proiectele</button>
        </div>
      )}

      {/* Carduri proiecte */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: G.muted }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Se încarcă proiectele...</div>
        </div>
      ) : proiecteVizibile.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: G.muted }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {alertFilter ? 'Niciun proiect pentru filtrul selectat' : 'Niciun proiect înregistrat'}
          </div>
          {isOwner && !alertFilter && <div style={{ fontSize: 13 }}>Apasă „＋ Proiect nou" pentru a adăuga primul proiect.</div>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 20 }}>
          {proiecteVizibile.map(p => (
            <ProiectCard
              key={p.id}
              proiect={p}
              isOwner={isOwner}
              canEdit={canEdit}
              onOpen={(tab) => onSelectProiect(p.id, tab)}
              onDetail={() => setSelectedProiect(p)}
              onEdit={() => setEditProiect(p)}
              onRefresh={loadAll}
              showToast={showToast}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {selectedProiect && (
        <ProiectDetailModal
          proiect={selectedProiect}
          isOwner={isOwner}
          canEdit={canEdit}
          onClose={() => setSelectedProiect(null)}
          onEdit={() => { setEditProiect(selectedProiect); setSelectedProiect(null) }}
          onOpen={(tab) => { setSelectedProiect(null); onSelectProiect(selectedProiect.id, tab) }}
        />
      )}
      {editProiect && (
        <ProiectEditModal
          proiect={editProiect}
          onClose={() => setEditProiect(null)}
          onSaved={() => { setEditProiect(null); loadAll() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ===========================================================================
// PROIECT CARD — click pe titlu sau "→ Deschide" navighează la context
// ===========================================================================
function ProiectCard({ proiect: p, isOwner, canEdit, onOpen, onDetail, onEdit, onRefresh, showToast }) {
  const terminStatus = (() => {
    if (!p.data_termen) return null
    const zile = p.zile_pana_termen
    if (zile < 0)   return { label: `Depășit cu ${Math.abs(zile)} zile`, color: G.red,    bg: G.red + '22' }
    if (zile <= 30)  return { label: `${zile} zile rămase`, color: G.red,    bg: G.red + '22' }
    if (zile <= 90)  return { label: `${zile} zile rămase`, color: G.yellow, bg: G.yellow + '22' }
    return                  { label: `${zile} zile rămase`, color: G.green,  bg: G.green + '22' }
  })()

  const pct = p.procent_timp_scurs
  const pctColor = !pct ? G.muted : pct >= 90 ? G.red : pct >= 70 ? G.yellow : G.executie

  return (
    <div style={{
      background: G.card, border: `1px solid ${G.border}`,
      borderRadius: 12, overflow: 'hidden',
      transition: 'box-shadow .15s ease, transform .1s ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 20px rgba(88,166,255,.12)`; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
    >
      {/* Accent strip */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${G.executie}, ${G.purple})` }} />

      {/* Header */}
      <div style={{ padding: '18px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4 }}>
              {p.cod_intern}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: G.text, lineHeight: 1.35, cursor: 'pointer' }}
              onClick={() => onOpen('proiect')}>
              {p.nume}
            </div>
            {/* Badge-uri sănătate: apar doar când lipsesc legăturile */}
            {p.nr_probleme > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                {!p.are_santier && (
                  <span style={{ fontSize: 9, padding: '2px 8px', background: G.red + '18', color: G.red, borderRadius: 8, fontWeight: 700, border: `1px solid ${G.red}44` }}>
                    🔴 Lipsă șantier
                  </span>
                )}
                {!p.are_contract && (
                  <span style={{ fontSize: 9, padding: '2px 8px', background: G.orange + '18', color: G.orange, borderRadius: 8, fontWeight: 700, border: `1px solid ${G.orange}44` }}>
                    ⚠️ Lipsă contract
                  </span>
                )}
                {!(p.data_termen) && (
                  <span style={{ fontSize: 9, padding: '2px 8px', background: G.yellow + '18', color: G.yellow, borderRadius: 8, fontWeight: 700, border: `1px solid ${G.yellow}44` }}>
                    📅 Lipsă termene
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {p.isc_faza_determinanta && (
              <div style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: '#EF444422', color: '#EF4444', border: '1px solid #EF444444',
              }}>🏛️ ISC·FD</div>
            )}
            {p.este_sistat && (
              <div style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: G.yellow + '22', color: G.yellow,
              }}>💤 Sistat</div>
            )}
            <div style={{
              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: p.activ ? G.green + '22' : G.border,
              color: p.activ ? G.green : G.muted,
            }}>
              {p.activ ? '● Activ' : '○ Inactiv'}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: G.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🏢</span> {p.beneficiar || '—'} &nbsp;·&nbsp;
          <span>📍</span> {p.site_name || '—'}
        </div>
      </div>

      {/* KPI grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: `1px solid ${G.border}`, borderBottom: `1px solid ${G.border}`,
      }}>
        {[
          { label: 'Tronsoane', value: p.nr_tronsoane ?? '—', icon: '📏' },
          { label: 'Pachete', value: p.nr_pachete ?? '—', icon: '📦' },
          { label: 'Lungime', value: fmtM(p.lungime_totala_m), icon: '📐' },
          { label: 'Valoare', value: p.valoare_lei ? fmtLei(p.valoare_lei) : p.oferta_valoare ? fmtLei(p.oferta_valoare) : '—', icon: '💰' },
        ].map((k, i) => (
          <div key={i} style={{
            padding: '12px 0', textAlign: 'center',
            borderRight: i < 3 ? `1px solid ${G.border}` : 'none',
          }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>{k.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: G.text }}>{k.value}</div>
            <div style={{ fontSize: 10, color: G.muted, marginTop: 1 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Rând materiale tehnice (din documente contractuale AI) */}
      {(p.curbe_buc != null || p.robineti_buc != null || p.flanse_electroizolate_buc != null) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          borderBottom: `1px solid ${G.border}`,
          background: G.blue + '05',
        }}>
          {[
            { label: 'Curbe',      value: p.curbe_buc ?? '—',                    icon: '🔄', color: G.teal },
            { label: 'Robineți',   value: p.robineti_buc ?? '—',                 icon: '🔩', color: G.orange },
            { label: 'Flanșe EI',  value: p.flanse_electroizolate_buc ?? '—',    icon: '⚡', color: G.yellow },
            { label: 'Mat. spec.', value: p.alte_materiale?.length ? `${p.alte_materiale.length} tip.` : '—', icon: '📦', color: G.muted },
          ].map((k, i) => (
            <div key={i} style={{
              padding: '8px 0', textAlign: 'center',
              borderRight: i < 3 ? `1px solid ${G.border}` : 'none',
            }}>
              <div style={{ fontSize: 14, marginBottom: 1 }}>{k.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 9, color: G.dim, marginTop: 1 }}>{k.label} · buc</div>
            </div>
          ))}
        </div>
      )}

      {/* Dacă lipsesc datele tehnice și lipsesc și datele contractuale */}
      {p.curbe_buc == null && !p.data_start && isOwner && (
        <div style={{ padding: '6px 14px', fontSize: 10, color: G.dim, background: G.bg, borderBottom: `1px solid ${G.border}`, display:'flex', alignItems:'center', gap:6 }}>
          <span>💡</span> Adaugă contract + documente tehnice pentru a popula cantitățile cu AI.
        </div>
      )}

      {/* ── Rând personal (din Pontaj) ── */}
      {p.pontaj_zile_om > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          borderBottom: `1px solid ${G.border}`,
          background: '#2DD4BF08',
        }}>
          {[
            { label: 'Angajați',   value: p.pontaj_angajati,    icon: '👷', color: G.teal },
            { label: 'Zile-om',    value: p.pontaj_zile_om?.toLocaleString('ro-RO'), icon: '📅', color: G.text },
            { label: 'Diurne',     value: p.pontaj_zile_diurna?.toLocaleString('ro-RO'), icon: '🍽️', color: G.yellow },
            { label: 'Supl. hrană',value: p.pontaj_zile_supliment > 0 ? p.pontaj_zile_supliment?.toLocaleString('ro-RO') : '—', icon: '🥗', color: p.pontaj_zile_supliment > 0 ? G.orange : G.dim },
          ].map((k, i) => (
            <div key={i} style={{
              padding: '7px 0', textAlign: 'center',
              borderRight: i < 3 ? `1px solid ${G.border}` : 'none',
            }}>
              <div style={{ fontSize: 13, marginBottom: 1 }}>{k.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 9, color: G.dim, marginTop: 1 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Termene */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Ord. Înc.</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>{fmtDate(p.data_start)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Termen</div>
            {p.este_sistat ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.yellow }}>
                  {p.data_ultima_sistare ? fmtDate(p.data_ultima_sistare) : fmtDate(p.data_termen)}
                </div>
                <div style={{ display:'inline-block', marginTop:3, padding:'1px 6px', borderRadius:4, fontSize:10, fontWeight:600, color: G.yellow, background: G.yellow + '22' }}>
                  ⏸ Sistat din ordin
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: terminStatus?.color || G.text }}>
                  {fmtDate(p.data_termen)}
                  {(p.prelungire_totala_luni > 0) && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: G.blue + '22', color: G.blue, borderRadius: 8, padding:'1px 6px' }}>
                      +{p.prelungire_totala_luni}L AA
                    </span>
                  )}
                </div>
                {terminStatus && (
                  <div style={{
                    display: 'inline-block', marginTop: 3,
                    padding: '1px 6px', borderRadius: 4,
                    fontSize: 10, fontWeight: 600,
                    color: terminStatus.color, background: terminStatus.bg,
                  }}>{terminStatus.label}</div>
                )}
              </>
            )}
          </div>
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Timp scurs</div>
            {pct !== null ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: pctColor }}>{pct}%</div>
                <div style={{ height: 4, background: G.border, borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, borderRadius: 2, background: p.este_sistat ? G.yellow : pctColor, transition: 'width .5s' }} />
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: G.dim }}>—</div>
            )}
          </div>
        </div>

        {(!p.data_start || !p.data_termen) && isOwner && (
          <div style={{
            marginTop: 10, padding: '7px 10px',
            background: G.yellow + '11', border: `1px solid ${G.yellow}44`,
            borderRadius: 6, fontSize: 11, color: G.yellow,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span onClick={async () => {
              if (p.data_start) return
              const d = window.prompt('Data ordinului de începere (AAAA-LL-ZZ):', new Date().toISOString().slice(0, 10))
              if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) { if (d) showToast('Format invalid — folosește AAAA-LL-ZZ', 'error'); return }
              const { error } = await supabase.from('executie_proiecte').update({ data_start: d.trim() }).eq('id', p.id)
              if (error) showToast('Eroare: ' + error.message, 'error')
              else { showToast('📅 Ordin de începere setat: ' + d.trim(), 'success'); onRefresh && onRefresh() }
            }} style={{ cursor: !p.data_start ? 'pointer' : 'default', textDecoration: !p.data_start ? 'underline' : 'none' }}
              title={!p.data_start ? 'Click — setează data ordinului de începere aici' : ''}>
            ⚠️ Lipsește: {[!p.data_start && 'ordinul de începere', !p.data_termen && 'termenul de finalizare'].filter(Boolean).join(' și ')} — {!p.data_start ? 'click aici pentru a-l seta' : 'apasă ✏️ Editează'}.
            </span>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: '12px 20px', borderTop: `1px solid ${G.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: G.bg,
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Buton principal: deschide contextul proiectului */}
          <button onClick={() => onOpen('proiect')} style={{
            padding: '6px 14px', background: G.executie, border: 'none',
            borderRadius: 6, color: '#0D1117', fontSize: 12, cursor: 'pointer', fontWeight: 700,
          }}>→ Deschide</button>
          <button onClick={onDetail} style={{
            padding: '6px 12px', background: G.card2, border: `1px solid ${G.border}`,
            borderRadius: 6, color: G.text, fontSize: 12, cursor: 'pointer', fontWeight: 600,
          }}>🔍 Detalii</button>
          <button onClick={() => onOpen('izometrie')} style={{
            padding: '6px 12px', background: G.purple + '22', border: `1px solid ${G.purple}55`,
            borderRadius: 6, color: G.purple, fontSize: 12, cursor: 'pointer', fontWeight: 600,
          }}>📐 Izometrie</button>
        </div>
        {canEdit && (
          <button onClick={onEdit} style={{
            padding: '6px 12px', background: 'transparent', border: `1px solid ${G.border}`,
            borderRadius: 6, color: G.muted, fontSize: 12, cursor: 'pointer',
          }}>✏️ Editează</button>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// PROIECT DETAIL MODAL (read-only quick view)
// ===========================================================================
function ProiectDetailModal({ proiect: p, isOwner, canEdit, onClose, onEdit, onOpen }) {
  const [personnel, setPersonnel] = useState({})
  useEffect(() => {
    const ids = [p.mp_employee_id, p.rts_employee_id, p.rte_employee_id].filter(Boolean)
    if (!ids.length) return
    supabase.from('employees').select('id, name, functie').in('id', ids)
      .then(({ data }) => { const m = {}; (data||[]).forEach(e => { m[e.id] = e }); setPersonnel(m) })
  }, [p.mp_employee_id, p.rts_employee_id, p.rte_employee_id])
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 680, maxHeight: '85vh', overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', borderBottom: `1px solid ${G.border}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 6 }}>
                {p.cod_intern}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: G.text, lineHeight: 1.3 }}>{p.nume}</div>
              <div style={{ fontSize: 13, color: G.muted, marginTop: 5 }}>
                {p.beneficiar} &nbsp;·&nbsp; {p.site_name || '—'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: G.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Ordin de începere', value: fmtDate(p.data_start) },
              { label: 'Termen finalizare', value: p.este_sistat
                  ? `⏸ Sistat (${p.data_ultima_sistare ? fmtDate(p.data_ultima_sistare) : 'manual'})`
                  : fmtDate(p.data_termen) + (p.prelungire_totala_luni > 0 ? ` +${p.prelungire_totala_luni} luni AA` : '') },
              { label: 'Valoare contract', value: p.valoare_lei ? fmtLei(p.valoare_lei) : '—' },
              { label: 'Valoare ofertă', value: p.oferta_valoare ? fmtLei(p.oferta_valoare) : '—' },
              { label: 'Nr. contract', value: p.nr_contract || p.numar_contract || '—' },
              { label: 'Data semnare', value: fmtDate(p.data_contract || p.contract_data_semnare) },
              { label: 'Acte adiționale', value: p.nr_acte_aditionale > 0 ? `${p.nr_acte_aditionale} acte · +${p.prelungire_totala_luni} luni` : '—' },
              { label: 'Ordine sistare', value: p.nr_ordine_sistare > 0 ? `${p.nr_ordine_sistare} ordine${p.este_sistat ? ' · ⏸ Activ' : ' · reluat'}` : '—' },
            ].map((row, i) => (
              <div key={i} style={{ background: G.bg, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{row.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>{row.value}</div>
              </div>
            ))}
          </div>

          {/* Echipă proiect + ISC */}
          {(p.mp_employee_id || p.rts_employee_id || p.rte_employee_id || p.coordonator_transgaz || p.isc_faza_determinanta) && (
            <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                👥 Echipă proiect
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                {[
                  { label: 'Manager Proiect (MP)',          id: p.mp_employee_id },
                  { label: 'Resp. Tehnic Execuție (RTE)',   id: p.rte_employee_id },
                  { label: 'Resp. Tehnic Sudură (RTS)',     id: p.rts_employee_id },
                  { label: 'Coordonator Transgaz',          val: p.coordonator_transgaz },
                ].filter(r => r.id || r.val).map((r, i) => (
                  <div key={i} style={{ background: G.card2, borderRadius: 7, padding: '8px 12px' }}>
                    <div style={{ fontSize: 9, color: G.muted, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: G.text }}>
                      {r.val || personnel[r.id]?.name || '⏳ se încarcă...'}
                    </div>
                    {r.id && personnel[r.id]?.functie && (
                      <div style={{ fontSize: 10, color: G.muted }}>{personnel[r.id].functie}</div>
                    )}
                  </div>
                ))}
              </div>
              {(p.isc_faza_determinanta || p.doc_itp_pccvi_path) && (
                <FazeDeterminanteISC proiect={p} />
              )}
            </div>
          )}

          {/* Stadiu execuție */}
          <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 12 }}>
              📊 Stadiu execuție (date Izometrie)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'Tronsoane', value: p.nr_tronsoane ?? '—', sub: 'definite' },
                { label: 'Pachete lansate', value: p.nr_pachete ?? '—', sub: 'Transgaz' },
                { label: 'Lungime totală', value: fmtM(p.lungime_totala_m), sub: 'din pachete' },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: G.executie }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: G.text, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: G.dim }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {p.procent_timp_scurs !== null && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: G.muted }}>Timp contractual scurs</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: p.procent_timp_scurs >= 80 ? G.red : G.yellow }}>{p.procent_timp_scurs}%</span>
                </div>
                <div style={{ height: 6, background: G.border, borderRadius: 3 }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${Math.min(100, p.procent_timp_scurs)}%`,
                    background: p.procent_timp_scurs >= 80 ? G.red : p.procent_timp_scurs >= 60 ? G.yellow : G.executie,
                    transition: 'width .5s',
                  }} />
                </div>
              </div>
            )}
          </div>

          {/* Cantități tehnice din documente AI */}
          {(p.curbe_buc != null || p.robineti_buc != null || p.flanse_electroizolate_buc != null || p.alte_materiale?.length > 0) && (
            <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' }}>
                  📋 Cantități tehnice (din documente contractuale)
                </div>
                {p.docs_ai_confidence > 0 && (
                  <span style={{ fontSize: 10, color: G.blue, background: G.blue + '22', padding: '2px 8px', borderRadius: 8 }}>
                    🤖 AI {p.docs_ai_confidence}% conf.
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: p.alte_materiale?.length ? 12 : 0 }}>
                {[
                  { label: 'Curbe', value: p.curbe_buc, icon: '🔄', color: G.teal, um: 'buc' },
                  { label: 'Robineți / Vane', value: p.robineti_buc, icon: '🔩', color: G.orange, um: 'buc' },
                  { label: 'Flanșe EI', value: p.flanse_electroizolate_buc, icon: '⚡', color: G.yellow, um: 'buc' },
                ].map((s, i) => (
                  <div key={i} style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 20, marginBottom: 3 }}>{s.icon}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.value != null ? s.color : G.dim }}>
                      {s.value ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: G.text }}>{s.label}</div>
                    <div style={{ fontSize: 9, color: G.dim }}>{s.um}</div>
                  </div>
                ))}
              </div>
              {p.alte_materiale?.length > 0 && (
                <div style={{ borderTop: `1px solid ${G.border}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 10, color: G.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.4px' }}>Alte materiale principale</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.alte_materiale.map((m, i) => (
                      <div key={i} style={{ background: G.card2, border: `1px solid ${G.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11 }}>
                        <span style={{ color: G.muted }}>{m.denumire}</span>
                        <span style={{ color: G.text, fontWeight: 700, marginLeft: 6 }}>{m.cantitate} {m.um}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {p.observatii && (
            <div style={{ background: G.bg, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: G.muted }}>
              <span style={{ fontWeight: 700, color: G.text }}>Observații: </span>{p.observatii}
            </div>
          )}

          {/* ── Cheltuieli personal (din Pontaj) ── */}
          {p.pontaj_zile_om > 0 && (
            <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 12, display:'flex', alignItems:'center', gap:8 }}>
                👷 Cheltuieli personal
                <span style={{ fontSize: 10, color: G.dim, textTransform: 'none', fontWeight: 400 }}>live din Pontaj</span>
                {p.pontaj_prima_zi && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: G.dim }}>
                    {new Date(p.pontaj_prima_zi).toLocaleDateString('ro-RO')} → {new Date(p.pontaj_ultima_zi).toLocaleDateString('ro-RO')}
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
                {[
                  { label: 'Angajați distincti', value: p.pontaj_angajati, icon: '👷', color: G.teal, sub: 'care au lucrat' },
                  { label: 'Zile-om cumulate', value: (p.pontaj_zile_om||0).toLocaleString('ro-RO'), icon: '📅', color: G.text, sub: 'person-days' },
                  { label: 'Ore estimate', value: ((p.pontaj_ore_estimate||0)).toLocaleString('ro-RO'), icon: '🕐', color: G.blue, sub: '× 8h/zi' },
                  { label: 'Zile cu diurnă', value: (p.pontaj_zile_diurna||0).toLocaleString('ro-RO'), icon: '🍽️', color: G.yellow, sub: 'deplasare' },
                ].map((s, i) => (
                  <div key={i} style={{ textAlign: 'center', padding: '8px 4px' }}>
                    <div style={{ fontSize: 18, marginBottom: 3 }}>{s.icon}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: G.text, fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: 9, color: G.dim }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Supliment hrană + bare vizuale */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {/* Diurne vs Zile-om */}
                <div style={{ background: G.surface, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: G.muted }}>🍽️ Zile cu diurnă</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: G.yellow }}>
                      {p.pontaj_zile_om > 0 ? Math.round(p.pontaj_zile_diurna / p.pontaj_zile_om * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ height: 6, background: G.border, borderRadius: 3 }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${p.pontaj_zile_om > 0 ? Math.min(100, p.pontaj_zile_diurna / p.pontaj_zile_om * 100) : 0}%`,
                      background: G.yellow,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: G.dim, marginTop: 4 }}>
                    {(p.pontaj_zile_diurna||0).toLocaleString('ro-RO')} din {(p.pontaj_zile_om||0).toLocaleString('ro-RO')} zile
                  </div>
                </div>

                {/* Supliment hrană */}
                <div style={{ background: G.surface, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: G.muted }}>🥗 Supliment hrană</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: G.orange }}>
                      {p.pontaj_zile_om > 0 ? Math.round((p.pontaj_zile_supliment||0) / p.pontaj_zile_om * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ height: 6, background: G.border, borderRadius: 3 }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${p.pontaj_zile_om > 0 ? Math.min(100, (p.pontaj_zile_supliment||0) / p.pontaj_zile_om * 100) : 0}%`,
                      background: G.orange,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: G.dim, marginTop: 4 }}>
                    {(p.pontaj_zile_supliment||0).toLocaleString('ro-RO')} din {(p.pontaj_zile_om||0).toLocaleString('ro-RO')} zile
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 10, color: G.dim, fontStyle: 'italic' }}>
                * Orele sunt estimate la 8h/zi. Pentru valoarea exactă a costurilor de personal, consultați raportul salarial din modulul HR.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${G.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end', background: G.bg,
        }}>
          <button onClick={() => onOpen('izometrie')} style={{
            padding: '8px 16px', background: G.purple + '22', border: `1px solid ${G.purple}55`,
            borderRadius: 7, color: G.purple, fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}>📐 Izometrie</button>
          <button onClick={() => onOpen('proiect')} style={{
            padding: '8px 16px', background: G.executie, border: 'none',
            borderRadius: 7, color: '#0D1117', fontSize: 13, cursor: 'pointer', fontWeight: 700,
          }}>→ Deschide proiect</button>
          {canEdit && (
            <button onClick={onEdit} style={{
              padding: '8px 16px', background: G.border2, border: `1px solid ${G.border}`,
              borderRadius: 7, color: G.text, fontSize: 13, cursor: 'pointer',
            }}>✏️ Editează</button>
          )}
          <button onClick={onClose} style={{
            padding: '8px 16px', background: G.border, border: 'none',
            borderRadius: 7, color: G.text, fontSize: 13, cursor: 'pointer',
          }}>Închide</button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// TIPURI DOCUMENTE ANEXĂ CONTRACT
// ===========================================================================
const TIPURI_DOC_CONTRACT = [
  { value: 'contract',           label: '📜 Contract principal' },
  { value: 'act_aditional',      label: '➕ Act adițional' },
  { value: 'garantie_exec',      label: '🏦 Garanție bună execuție' },
  { value: 'garantie_eliberare', label: '🔓 Eliberare garanție' },
  { value: 'ordin_incepere',     label: '🚦 Ordin de începere' },
  { value: 'autorizatie',        label: '📋 Autorizație construcție' },
  { value: 'aviz',               label: '📌 Aviz de amplasament' },
  { value: 'grafic',             label: '📅 Grafic de execuție' },
  { value: 'protocol_receptie',  label: '✅ Protocol recepție' },
  { value: 'altele',             label: '📎 Altele' },
]
const BUCKET_CONTRACTE = 'executie-contracte'

// ===========================================================================
// PROIECT EDIT MODAL (owner-only)
// ===========================================================================
function ProiectEditModal({ proiect, onClose, onSaved, showToast }) {
  const isNew = proiect._isNew === true
  const [form, setForm] = useState({
    cod_intern:    proiect.cod_intern    || '',
    nume:          proiect.nume          || '',
    beneficiar:    proiect.beneficiar    || '',
    observatii:    proiect.observatii    || '',
    nr_contract:   proiect.nr_contract   || '',
    data_contract: proiect.data_contract || '',
    data_start:    proiect.data_start    || '',
    data_termen:   proiect.data_termen   || '',
    valoare_lei:   proiect.valoare_lei   || '',
    valoare_eur:   proiect.valoare_eur   || '',
    site_id:       proiect.site_id       || '',
    activ:         proiect.activ !== false,
    manual_sistat: proiect.manual_sistat === true,
    // ─── NAS Scanner mapping ──────────────────────────────────────────────────
    numar_inventar:   proiect.numar_inventar   || '',
    nas_folder_path:  proiect.nas_folder_path  || '',
    // ─── Persoane cheie ─────────────────────────────────────────────────────
    mp_employee_id:       proiect.mp_employee_id        || '',
    rts_employee_id:      proiect.rts_employee_id       || '',
    rte_employee_id:      proiect.rte_employee_id       || '',
    coordonator_transgaz: proiect.coordonator_transgaz  || '',
    isc_faza_determinanta: proiect.isc_faza_determinanta === true,
  })
  const [employees, setEmployees] = useState([]) // pentru dropdownuri persoane cheie
  const [sites, setSites]   = useState([])
  const [saving, setSaving] = useState(false)
  // ─── PDF Ordin de începere (15.07): upload direct pe proiect, pattern PCCVI ──
  const [oiPath, setOiPath] = useState(proiect.doc_ordin_incepere_path || '')
  const [oiBusy, setOiBusy] = useState(false)
  const uploadOrdinIncepere = async (file) => {
    if (!file || isNew) return
    if (file.type !== 'application/pdf') { showToast('Doar fișiere PDF', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { showToast('PDF prea mare (max 10MB)', 'error'); return }
    setOiBusy(true)
    try {
      const path = `ordin-incepere/${proiect.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from(BUCKET_CONTRACTE).upload(path, file, { upsert: false })
      if (upErr) throw new Error('Upload: ' + upErr.message)
      const { error: dbErr } = await supabase.from('executie_proiecte').update({ doc_ordin_incepere_path: path }).eq('id', proiect.id)
      if (dbErr) throw new Error(dbErr.message)
      setOiPath(path)
      showToast('📎 Ordin de începere atașat', 'success')
    } catch (e) { showToast('Eroare atașare ordin: ' + e.message, 'error') }
    setOiBusy(false)
  }
  const openOrdinIncepere = async () => {
    if (!oiPath) return
    const { data } = await supabase.storage.from(BUCKET_CONTRACTE).createSignedUrl(oiPath, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // ─── Documente tehnice contractuale ─────────────────────────────────────
  const [docPaths, setDocPaths] = useState({
    caiet_sarcini:       proiect.doc_caiet_sarcini_path       || null,
    propunere_tehnica:   proiect.doc_propunere_tehnica_path   || null,
    propunere_financiara: proiect.doc_propunere_financiara_path || null,
    itp_pccvi:           proiect.doc_itp_pccvi_path           || null,
  })
  const [uploadingTehnic, setUploadingTehnic] = useState(null)
  const [extractingAI, setExtractingAI]       = useState(false)
  const [extractingITP, setExtractingITP]     = useState(false)

  // 11.06 FIX STALE: prop-ul „proiect" vine din lista încărcată la deschiderea paginii —
  // editările din dashboard (echipă, PCCVI) nu apar și salvarea ar SUPRASCRIE cu valori vechi.
  // Re-fetch live la deschiderea modalului:
  useEffect(() => {
    if (!proiect?.id) return
    supabase.from('executie_proiecte')
      .select('mp_employee_id, rts_employee_id, rte_employee_id, coordonator_transgaz, isc_faza_determinanta, doc_caiet_sarcini_path, doc_propunere_tehnica_path, doc_propunere_financiara_path, doc_itp_pccvi_path, doc_itp_ai_faze_det, doc_itp_ai_confidence')
      .eq('id', proiect.id).single()
      .then(({ data }) => {
        if (!data) return
        setForm(f => ({ ...f,
          mp_employee_id:       data.mp_employee_id       || '',
          rts_employee_id:      data.rts_employee_id      || '',
          rte_employee_id:      data.rte_employee_id      || '',
          coordonator_transgaz: data.coordonator_transgaz || '',
          isc_faza_determinanta: data.isc_faza_determinanta === true,
        }))
        setDocPaths({
          caiet_sarcini:        data.doc_caiet_sarcini_path        || null,
          propunere_tehnica:    data.doc_propunere_tehnica_path    || null,
          propunere_financiara: data.doc_propunere_financiara_path || null,
          itp_pccvi:            data.doc_itp_pccvi_path            || null,
        })
        setItpAI(prev => ({ ...prev, faze_det: data.doc_itp_ai_faze_det || 0, confidence: data.doc_itp_ai_confidence || 0 }))
      })
  }, [proiect?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const [itpAI, setItpAI] = useState({
    participants: [],
    faze_det: proiect.doc_itp_ai_faze_det    || 0,
    confidence: proiect.doc_itp_ai_confidence || 0,
  })
  const [cantitati, setCantitati]             = useState({
    curbe_buc:                proiect.curbe_buc                    ?? null,
    robineti_buc:             proiect.robineti_buc                 ?? null,
    flanse_electroizolate_buc: proiect.flanse_electroizolate_buc   ?? null,
    alte_materiale:           proiect.alte_materiale               || null,
    docs_ai_confidence:       proiect.docs_ai_confidence           || 0,
  })

  const DOC_TEHNICE = [
    { key: 'propunere_financiara', label: '💰 Propunere financiară', hint: 'Deviz — sursa primară pentru cantități' },
    { key: 'propunere_tehnica',    label: '🔧 Propunere tehnică',    hint: 'Metodologie + cantități secundare' },
    { key: 'caiet_sarcini',        label: '📋 Caiet de sarcini',     hint: 'Specificații tehnice Transgaz' },
    { key: 'itp_pccvi',            label: '🔍 ITP-PCCVI',            hint: 'Plan de inspecții și încercări — participanți + faze determinate' },
  ]

  const handleUploadDocTehnic = async (tip, file) => {
    if (!file || !proiect.id) return
    setUploadingTehnic(tip)
    try {
      const safeName = file.name.replace(/\s+/g, '_')
      const path = `${proiect.id}/docs_tehnice/${tip}_${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET_CONTRACTE).upload(path, file, { upsert: true })
      if (upErr) throw upErr
      // Salvăm path în BD
      const colMap = {
        caiet_sarcini:        'doc_caiet_sarcini_path',
        propunere_tehnica:    'doc_propunere_tehnica_path',
        propunere_financiara: 'doc_propunere_financiara_path',
        itp_pccvi:            'doc_itp_pccvi_path',
      }
      await supabase.from('executie_proiecte').update({ [colMap[tip]]: path, updated_at: new Date().toISOString() }).eq('id', proiect.id)
      setDocPaths(prev => ({ ...prev, [tip]: path }))
      showToast(`${tip.replace(/_/g, ' ')} încărcat!`, 'success')
    } catch(e) { showToast('Eroare upload: ' + e.message, 'error') }
    finally { setUploadingTehnic(null) }
  }

  const handleExtractAI = async () => {
    if (!proiect.id) { showToast('Salvați proiectul mai întâi', 'error'); return }
    const hasDoc = Object.values(docPaths).some(v => v)
    if (!hasDoc) { showToast('Încărcați cel puțin un document tehnic', 'error'); return }
    setExtractingAI(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-project-docs-ai`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proiect_id: proiect.id }),
      })
      const res = await resp.json()
      if (!resp.ok) throw new Error(res.error || 'Eroare extracție')
      const r = res.rezultat
      setCantitati({
        curbe_buc: r.curbe_buc ?? null,
        robineti_buc: r.robineti_buc ?? null,
        flanse_electroizolate_buc: r.flanse_electroizolate_buc ?? null,
        alte_materiale: r.alte_materiale || null,
        docs_ai_confidence: r.confidence || 0,
      })
      showToast(`AI extras cu ${r.confidence}% încredere din ${res.docs_procesate} doc.`, 'success')
    } catch(e) { showToast('Eroare AI: ' + e.message, 'error') }
    finally { setExtractingAI(false) }
  }

  const handleExtractITP = async () => {
    if (!proiect.id) { showToast('Salvați proiectul mai întâi', 'error'); return }
    if (!docPaths.itp_pccvi) { showToast('Încărcați mai întâi ITP-PCCVI', 'error'); return }
    setExtractingITP(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-itp-ai`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proiect_id: proiect.id }),
      })
      const res = await resp.json()
      if (!resp.ok) throw new Error(res.error || 'Eroare extracție ITP')
      const r = res.rezultat
      setItpAI({ participants: r.participants_confirmed || [], faze_det: r.faze_determinate_isc_count || 0, confidence: r.confidence || 0 })
      // Auto-completează ISC dacă detectat
      if (r.isc_faza_determinanta !== undefined) set('isc_faza_determinanta', r.isc_faza_determinanta)
      showToast(`ITP analizat: ${r.faze_determinate_isc_count || 0} FD-uri ISC, ${r.confidence}% confidence`, 'success')
      // 11.06.2026: populează AUTOMAT și lista fazelor determinante (tabel + checklist),
      // nu doar contorul — fără pas manual suplimentar
      try {
        const resp2 = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pccvi-faze`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ proiect_id: proiect.id, pdf_path: docPaths.itp_pccvi }),
        })
        const res2 = await resp2.json()
        if (resp2.ok && (res2.extrase > 0 || res2.total_faze > 0)) {
          // 11.06: dacă s-au populat faze, bifăm AUTOMAT „ISC – Faza Determinantă" în formular
          set('isc_faza_determinanta', true)
          showToast(`📋 ${res2.extrase} faze determinante populate în checklist · ISC bifat automat`, 'success')
        }
      } catch { /* chain best-effort: contorul e setat oricum */ }
    } catch(e) { showToast('Eroare AI ITP: ' + e.message, 'error') }
    finally { setExtractingITP(false) }
  }

  const handleOpenDocTehnic = async (path) => {
    const { data } = await supabase.storage.from(BUCKET_CONTRACTE).createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // ─── Documente contract (atașamente) ────────────────────────────────────
  const [docsContract, setDocsContract]        = useState([])
  const [addingDoc, setAddingDoc]              = useState(false)
  const [uploadingDoc, setUploadingDoc]        = useState(false)
  const [uploadTip, setUploadTip]              = useState(TIPURI_DOC_CONTRACT[0]?.value || '')

  // ─── Acte adiționale ────────────────────────────────────────────────────
  const [acteAditionale, setActeAditionale]   = useState([])
  const [expandActs, setExpandActs]           = useState(false)
  const [showAddAct, setShowAddAct]           = useState(false)
  const [savingAct, setSavingAct]             = useState(false)
  const [formAct, setFormAct]                 = useState({ numar_act:'', data_semnare:'', prelungire_luni:'0', descriere:'' })

  // ─── Ordine de sistare ───────────────────────────────────────────────────
  const [ordineSistare, setOrdineSistare]     = useState([])
  const [expandOrdine, setExpandOrdine]       = useState(false)
  const [showAddOrdine, setShowAddOrdine]     = useState(false)
  const [savingOrdine, setSavingOrdine]       = useState(false)
  const [formOrdine, setFormOrdine]           = useState({ numar_ordin:'', data_sistare:'', data_reluare:'', motiv:'' })
  const [editReluareId, setEditReluareId]     = useState(null) // id ordin pentru care adăugăm reluare
  const [reluareData, setReluareData]         = useState('')

  const loadDocs = async () => {
    if (isNew) return
    const { data } = await supabase
      .from('executie_documente_contract')
      .select('*').eq('proiect_id', proiect.id).eq('activ', true)
      .order('uploadat_la', { ascending: false })
    setDocsContract(data || [])
  }

  const loadActs = async () => {
    if (isNew) return
    const { data } = await supabase
      .from('executie_acte_aditionale')
      .select('*').eq('proiect_id', proiect.id).eq('activ', true)
      .order('creat_la')
    setActeAditionale(data || [])
  }

  const loadOrdine = async () => {
    if (isNew) return
    const { data } = await supabase
      .from('executie_ordine_sistare')
      .select('*').eq('proiect_id', proiect.id).eq('activ', true)
      .order('data_sistare')
    setOrdineSistare(data || [])
  }

  useEffect(() => {
    supabase.from('sites').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setSites(data || []))
    supabase.from('employees').select('id, name, functie').eq('active', true).order('name')
      .then(({ data }) => setEmployees(data || []))
    loadDocs(); loadActs(); loadOrdine()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.cod_intern.trim() || !form.nume.trim()) {
      showToast('Cod intern și Nume sunt obligatorii', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        cod_intern:    form.cod_intern.trim(),
        nume:          form.nume.trim(),
        beneficiar:    form.beneficiar.trim() || null,
        observatii:    form.observatii.trim() || null,
        nr_contract:   form.nr_contract.trim() || null,
        data_contract: form.data_contract || null,
        numar_inventar: form.numar_inventar ? parseInt(String(form.numar_inventar)) : null,
        nas_folder_path: form.nas_folder_path.trim() || null,
        data_start:    form.data_start || null,
        data_termen:   form.data_termen || null,
        valoare_lei:   form.valoare_lei ? parseFloat(form.valoare_lei) : null,
        valoare_eur:   form.valoare_eur ? parseFloat(form.valoare_eur) : null,
        site_id:       form.site_id ? parseInt(form.site_id) : null,
        activ:         form.activ,
        manual_sistat: form.manual_sistat,
        // persoane cheie
        mp_employee_id:       form.mp_employee_id  ? parseInt(form.mp_employee_id)  : null,
        rts_employee_id:      form.rts_employee_id ? parseInt(form.rts_employee_id) : null,
        rte_employee_id:      form.rte_employee_id ? parseInt(form.rte_employee_id) : null,
        coordonator_transgaz: form.coordonator_transgaz.trim() || null,
        isc_faza_determinanta: form.isc_faza_determinanta,
        updated_at:    new Date().toISOString(),
      }
      let error
      if (isNew) {
        const res = await supabase.from('executie_proiecte').insert(payload)
        error = res.error
      } else {
        const res = await supabase.from('executie_proiecte').update(payload).eq('id', proiect.id)
        error = res.error
      }
      if (error) throw error
      showToast(isNew ? 'Proiect creat cu succes!' : 'Proiect actualizat!', 'success')
      onSaved()
    } catch(e) {
      showToast('Eroare: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Upload document ──────────────────────────────────────────────────────
  const handleUploadDoc = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadingDoc(true)
    try {
      const safeName = file.name.replace(/\s+/g, '_')
      const path = `${proiect.id}/${uploadTip}/${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET_CONTRACTE).upload(path, file)
      if (upErr) throw upErr
      const { data: { user } } = await supabase.auth.getUser()
      const { error: insErr } = await supabase.from('executie_documente_contract').insert({
        proiect_id:       proiect.id,
        tip_document:     uploadTip,
        fisier_path:      path,
        fisier_nume:      file.name,
        fisier_size_bytes: file.size,
        fisier_mime:      file.type || 'application/pdf',
        uploadat_de:      user?.id,
      })
      if (insErr) throw insErr
      showToast('Document adăugat!', 'success')
      loadDocs()
    } catch(e) {
      showToast('Eroare upload: ' + e.message, 'error')
    } finally {
      setUploadingDoc(false)
      e.target.value = ''
    }
  }

  const handleOpenDoc = async (path) => {
    const { data } = await supabase.storage.from(BUCKET_CONTRACTE).createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else showToast('Eroare la deschidere URL', 'error')
  }

  const handleDeleteDoc = async (doc) => {
    if (!confirm(`Ștergi "${doc.fisier_nume}"? (ireversibil)`)) return
    await supabase.storage.from(BUCKET_CONTRACTE).remove([doc.fisier_path])
    await supabase.from('executie_documente_contract').update({ activ: false }).eq('id', doc.id)
    showToast('Document șters', 'success')
    loadDocs()
  }

  // ─── Acte adiționale ──────────────────────────────────────────────────────
  const handleAddAct = async () => {
    if (!formAct.numar_act.trim()) { showToast('Numărul actului e obligatoriu', 'error'); return }
    setSavingAct(true)
    try {
      const { error } = await supabase.from('executie_acte_aditionale').insert({
        proiect_id:              proiect.id,
        numar_act:               formAct.numar_act.trim(),
        data_semnare:            formAct.data_semnare || null,
        prelungire_luni:         parseInt(formAct.prelungire_luni) || 0,
        descriere:               formAct.descriere.trim() || null,
      })
      if (error) throw error
      showToast('Act adițional adăugat!', 'success')
      setFormAct({ numar_act:'', data_semnare:'', prelungire_luni:'0', descriere:'' })
      setShowAddAct(false)
      loadActs()
    } catch(e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setSavingAct(false) }
  }

  const handleDeleteAct = async (id) => {
    if (!confirm('Ștergi actul adițional?')) return
    await supabase.from('executie_acte_aditionale').update({ activ: false }).eq('id', id)
    showToast('Act adițional șters', 'success')
    loadActs()
  }

  // ─── Ordine de sistare ────────────────────────────────────────────────────
  const handleAddOrdine = async () => {
    if (!formOrdine.data_sistare) { showToast('Data sistare e obligatorie', 'error'); return }
    setSavingOrdine(true)
    try {
      const { error } = await supabase.from('executie_ordine_sistare').insert({
        proiect_id:   proiect.id,
        numar_ordin:  formOrdine.numar_ordin.trim() || null,
        data_sistare: formOrdine.data_sistare,
        data_reluare: formOrdine.data_reluare || null,
        motiv:        formOrdine.motiv.trim() || null,
      })
      if (error) throw error
      showToast('Ordin de sistare adăugat!', 'success')
      setFormOrdine({ numar_ordin:'', data_sistare:'', data_reluare:'', motiv:'' })
      setShowAddOrdine(false)
      loadOrdine()
    } catch(e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setSavingOrdine(false) }
  }

  const handleSetReluare = async (id) => {
    if (!reluareData) { showToast('Selectează data reluării', 'error'); return }
    const { error } = await supabase.from('executie_ordine_sistare')
      .update({ data_reluare: reluareData }).eq('id', id)
    if (error) { showToast('Eroare: ' + error.message, 'error'); return }
    showToast('Reluare înregistrată!', 'success')
    setEditReluareId(null); setReluareData('')
    loadOrdine()
  }

  const handleDeleteOrdine = async (id) => {
    if (!confirm('Ștergi ordinul de sistare?')) return
    await supabase.from('executie_ordine_sistare').update({ activ: false }).eq('id', id)
    showToast('Ordin șters', 'success')
    loadOrdine()
  }

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    background: G.bg, border: `1px solid ${G.border}`, borderRadius: 7,
    padding: '9px 12px', color: G.text, fontSize: 13, outline: 'none',
  }
  const labelStyle = {
    fontSize: 11, color: G.muted, textTransform: 'uppercase',
    letterSpacing: '.5px', marginBottom: 5, display: 'block',
  }
  const secTitle = {
    fontSize: 11, fontWeight: 700, color: G.muted, textTransform: 'uppercase',
    letterSpacing: '.6px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1010,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto',
      }}>
        {/* Header modal */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: G.surface, zIndex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isNew ? '＋ Proiect nou' : `✏️ Editează: ${proiect.cod_intern}`}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: G.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Identificare proiect ─────────────────────────────────────── */}
          <div style={secTitle}><span>📁</span> Identificare</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Cod intern *</label>
              <input value={form.cod_intern} onChange={e => set('cod_intern', e.target.value)} style={fieldStyle} placeholder="ex: PRUNISOR_JUPA" />
            </div>
            <div>
              <label style={labelStyle}>Beneficiar</label>
              <input value={form.beneficiar} onChange={e => set('beneficiar', e.target.value)} style={fieldStyle} placeholder="ex: S.N.T.G.N. TRANSGAZ S.A." />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Denumire proiect *</label>
            <input value={form.nume} onChange={e => set('nume', e.target.value)} style={fieldStyle} placeholder="Denumire completă a proiectului" />
          </div>

          <div>
            <label style={labelStyle}>Șantier principal</label>
            <select value={form.site_id} onChange={e => set('site_id', e.target.value)} style={fieldStyle}>
              <option value="">— Neatribuit —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* ── Date contractuale ───────────────────────────────────────── */}
          <div style={{ borderTop: `1px solid ${G.border}`, paddingTop: 14 }}>
            <div style={secTitle}><span>📑</span> Contract</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Nr. contract</label>
                <input value={form.nr_contract} onChange={e => set('nr_contract', e.target.value)} style={fieldStyle} placeholder="ex: 30/CTG1/2025" />
              </div>
              <div>
                <label style={labelStyle}>Data semnare contract</label>
                <input type="date" value={form.data_contract} onChange={e => set('data_contract', e.target.value)} style={fieldStyle} />
              </div>
            </div>

            {/* ── Acte adiționale ──────────────────────────────────────── */}
            {!isNew && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: expandActs ? 10 : 0 }}>
                  <button onClick={() => setExpandActs(v => !v)} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7, padding: 0,
                  }}>
                    <span style={{ fontSize: 12, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                      {expandActs ? '▾' : '▸'} Acte adiționale
                    </span>
                    {acteAditionale.length > 0 && (
                      <span style={{ background: G.blue + '33', color: G.blue, borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>
                        {acteAditionale.length} · +{acteAditionale.reduce((s, a) => s + (a.prelungire_luni || 0), 0)} luni
                      </span>
                    )}
                  </button>
                  {expandActs && (
                    <button onClick={() => { setShowAddAct(v => !v); setFormAct({ numar_act:'', data_semnare:'', prelungire_luni:'0', descriere:'' }) }} style={{
                      padding: '4px 10px', background: G.blue + '22', border: `1px solid ${G.blue}44`,
                      borderRadius: 6, color: G.blue, fontSize: 11, cursor: 'pointer', fontWeight: 700,
                    }}>＋ Adaugă</button>
                  )}
                </div>

                {expandActs && (
                  <div style={{ paddingLeft: 4 }}>
                    {/* Form add act */}
                    {showAddAct && (
                      <div style={{ background: G.card2, borderRadius: 8, padding: '12px 14px', marginBottom: 10, border: `1px solid ${G.blue}33` }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={labelStyle}>Nr. act *</label>
                            <input value={formAct.numar_act} onChange={e => setFormAct(f => ({...f, numar_act: e.target.value}))} style={fieldStyle} placeholder="ex: AA1 / Act Ad. nr.1" />
                          </div>
                          <div>
                            <label style={labelStyle}>Data semnare</label>
                            <input type="date" value={formAct.data_semnare} onChange={e => setFormAct(f => ({...f, data_semnare: e.target.value}))} style={fieldStyle} />
                          </div>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={labelStyle}>Prelungire (luni)</label>
                            <input type="number" min="0" max="60" value={formAct.prelungire_luni} onChange={e => setFormAct(f => ({...f, prelungire_luni: e.target.value}))} style={fieldStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Descriere</label>
                            <input value={formAct.descriere} onChange={e => setFormAct(f => ({...f, descriere: e.target.value}))} style={fieldStyle} placeholder="Modificări aduse prin act" />
                          </div>
                        </div>
                        <div style={{ display:'flex', gap: 8, justifyContent:'flex-end' }}>
                          <button onClick={() => setShowAddAct(false)} style={{ padding:'6px 12px', background: G.border, border:'none', borderRadius: 6, color: G.text, fontSize: 12, cursor:'pointer' }}>Anulează</button>
                          <button onClick={handleAddAct} disabled={savingAct} style={{ padding:'6px 14px', background: G.blue, border:'none', borderRadius: 6, color:'#0D1117', fontSize: 12, fontWeight: 700, cursor: savingAct ? 'not-allowed':'pointer', opacity: savingAct ? 0.6 : 1 }}>{savingAct ? '...' : '✓ Salvează'}</button>
                        </div>
                      </div>
                    )}

                    {/* Lista acte */}
                    {acteAditionale.length === 0 && !showAddAct && (
                      <div style={{ fontSize: 12, color: G.dim, fontStyle: 'italic', padding: '6px 0' }}>Niciun act adițional.</div>
                    )}
                    {acteAditionale.map(act => (
                      <div key={act.id} style={{
                        display:'flex', alignItems:'center', gap: 10,
                        background: G.card2, borderRadius: 8, padding: '9px 12px',
                        marginBottom: 6, border: `1px solid ${G.border}`,
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: G.text }}>
                            {act.numar_act}
                            {act.prelungire_luni > 0 && (
                              <span style={{ marginLeft: 8, background: G.blue + '22', color: G.blue, borderRadius: 8, padding: '1px 7px', fontSize: 10 }}>
                                +{act.prelungire_luni} luni
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: G.muted, marginTop: 2 }}>
                            {act.data_semnare ? fmtDate(act.data_semnare) : 'fără dată'}
                            {act.descriere ? ` · ${act.descriere}` : ''}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteAct(act.id)} style={{ background:'transparent', border:'none', color: G.red, fontSize: 15, cursor:'pointer', padding:'2px 4px' }}>🗑</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Ordine de sistare ────────────────────────────────────── */}
            {!isNew && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: expandOrdine ? 10 : 0 }}>
                  <button onClick={() => setExpandOrdine(v => !v)} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7, padding: 0,
                  }}>
                    <span style={{ fontSize: 12, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                      {expandOrdine ? '▾' : '▸'} Ordine de sistare
                    </span>
                    {ordineSistare.length > 0 && (
                      <span style={{
                        background: ordineSistare.some(o => !o.data_reluare) ? G.yellow + '33' : G.border,
                        color: ordineSistare.some(o => !o.data_reluare) ? G.yellow : G.muted,
                        borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700,
                      }}>
                        {ordineSistare.length}
                        {ordineSistare.some(o => !o.data_reluare) && ' · Activ sistat'}
                      </span>
                    )}
                  </button>
                  {expandOrdine && (
                    <button onClick={() => { setShowAddOrdine(v => !v); setFormOrdine({ numar_ordin:'', data_sistare:'', data_reluare:'', motiv:'' }) }} style={{
                      padding: '4px 10px', background: G.yellow + '22', border: `1px solid ${G.yellow}44`,
                      borderRadius: 6, color: G.yellow, fontSize: 11, cursor: 'pointer', fontWeight: 700,
                    }}>＋ Adaugă</button>
                  )}
                </div>

                {expandOrdine && (
                  <div style={{ paddingLeft: 4 }}>
                    {/* Form add ordin */}
                    {showAddOrdine && (
                      <div style={{ background: G.card2, borderRadius: 8, padding: '12px 14px', marginBottom: 10, border: `1px solid ${G.yellow}33` }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={labelStyle}>Nr. ordin</label>
                            <input value={formOrdine.numar_ordin} onChange={e => setFormOrdine(f => ({...f, numar_ordin: e.target.value}))} style={fieldStyle} placeholder="ex: OS-2026-01" />
                          </div>
                          <div>
                            <label style={labelStyle}>Data sistare *</label>
                            <input type="date" value={formOrdine.data_sistare} onChange={e => setFormOrdine(f => ({...f, data_sistare: e.target.value}))} style={fieldStyle} />
                          </div>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap: 8, marginBottom: 8 }}>
                          <div>
                            <label style={labelStyle}>Data reluare</label>
                            <input type="date" value={formOrdine.data_reluare} onChange={e => setFormOrdine(f => ({...f, data_reluare: e.target.value}))} style={fieldStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>Motiv</label>
                            <input value={formOrdine.motiv} onChange={e => setFormOrdine(f => ({...f, motiv: e.target.value}))} style={fieldStyle} placeholder="ex: condiții meteo, incident..." />
                          </div>
                        </div>
                        <div style={{ display:'flex', gap: 8, justifyContent:'flex-end' }}>
                          <button onClick={() => setShowAddOrdine(false)} style={{ padding:'6px 12px', background: G.border, border:'none', borderRadius: 6, color: G.text, fontSize: 12, cursor:'pointer' }}>Anulează</button>
                          <button onClick={handleAddOrdine} disabled={savingOrdine} style={{ padding:'6px 14px', background: G.yellow, border:'none', borderRadius: 6, color:'#0D1117', fontSize: 12, fontWeight: 700, cursor: savingOrdine ? 'not-allowed':'pointer', opacity: savingOrdine ? 0.6 : 1 }}>{savingOrdine ? '...' : '✓ Salvează'}</button>
                        </div>
                      </div>
                    )}

                    {/* Lista ordine */}
                    {ordineSistare.length === 0 && !showAddOrdine && (
                      <div style={{ fontSize: 12, color: G.dim, fontStyle: 'italic', padding: '6px 0' }}>Niciun ordin de sistare.</div>
                    )}
                    {ordineSistare.map(os => {
                      const activ = !os.data_reluare
                      return (
                        <div key={os.id} style={{
                          background: activ ? G.yellow + '0D' : G.card2,
                          borderRadius: 8, padding: '10px 12px', marginBottom: 6,
                          border: `1px solid ${activ ? G.yellow + '44' : G.border}`,
                        }}>
                          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: activ ? G.yellow : G.text, display:'flex', alignItems:'center', gap: 8 }}>
                                {activ && <span>⏸</span>}
                                {os.numar_ordin || 'Fără nr. ordin'}
                                {activ && <span style={{ background: G.yellow + '22', color: G.yellow, borderRadius: 8, padding:'1px 7px', fontSize:10 }}>Activ</span>}
                              </div>
                              <div style={{ fontSize: 10, color: G.muted, marginTop: 3, display:'flex', gap: 10, flexWrap:'wrap' }}>
                                <span>Sistat: {fmtDate(os.data_sistare)}</span>
                                {os.data_reluare && <span style={{ color: G.green }}>Reluat: {fmtDate(os.data_reluare)}</span>}
                                {os.motiv && <span>· {os.motiv}</span>}
                              </div>
                              {/* Înregistrare reluare inline */}
                              {activ && editReluareId === os.id && (
                                <div style={{ display:'flex', gap: 6, marginTop: 8, alignItems:'center' }}>
                                  <input type="date" value={reluareData} onChange={e => setReluareData(e.target.value)} style={{ ...fieldStyle, flex:1, padding:'6px 10px', fontSize:12 }} />
                                  <button onClick={() => handleSetReluare(os.id)} style={{ padding:'6px 12px', background: G.green, border:'none', borderRadius:6, color:'#0D1117', fontSize:12, fontWeight:700, cursor:'pointer' }}>✓</button>
                                  <button onClick={() => { setEditReluareId(null); setReluareData('') }} style={{ padding:'6px 10px', background: G.border, border:'none', borderRadius:6, color:G.text, fontSize:12, cursor:'pointer' }}>✕</button>
                                </div>
                              )}
                            </div>
                            <div style={{ display:'flex', gap: 4, flexShrink:0 }}>
                              {activ && editReluareId !== os.id && (
                                <button onClick={() => { setEditReluareId(os.id); setReluareData('') }} style={{ padding:'4px 9px', background: G.green + '22', border:`1px solid ${G.green}44`, borderRadius:6, color:G.green, fontSize:10, cursor:'pointer', fontWeight:700 }}>
                                  ▶ Reluare
                                </button>
                              )}
                              <button onClick={() => handleDeleteOrdine(os.id)} style={{ background:'transparent', border:'none', color: G.red, fontSize:14, cursor:'pointer', padding:'2px 4px' }}>🗑</button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Termene ─────────────────────────────────────────────────── */}
          <div>
            <div style={secTitle}><span>📅</span> Termene</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Ordin de începere</label>
                <input type="date" value={form.data_start} onChange={e => set('data_start', e.target.value)} style={fieldStyle} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!isNew ? (
                    <>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: G.executie + '18', color: G.executie, border: `1px solid ${G.executie}55`, borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: oiBusy ? 'wait' : 'pointer' }}>
                        {oiBusy ? '⏳ Se încarcă...' : (oiPath ? '📎 Înlocuiește PDF' : '📎 Atașează PDF ordin')}
                        <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={oiBusy}
                               onChange={e => { uploadOrdinIncepere(e.target.files?.[0]); e.target.value = '' }} />
                      </label>
                      {oiPath && (
                        <button type="button" onClick={openOrdinIncepere}
                                style={{ padding: '6px 12px', background: G.blue + '18', color: G.blue, border: `1px solid ${G.blue}55`, borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          📄 Vezi PDF
                        </button>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: G.dim }}>PDF-ul ordinului se atașează după prima salvare a proiectului.</span>
                  )}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Termen finalizare</label>
                <input type="date" value={form.data_termen} onChange={e => set('data_termen', e.target.value)} style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* ── Valori ──────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Valoare contract (RON)</label>
              <input type="number" value={form.valoare_lei} onChange={e => set('valoare_lei', e.target.value)} style={fieldStyle} placeholder="0" min="0" step="1000" />
            </div>
            <div>
              <label style={labelStyle}>Valoare contract (EUR)</label>
              <input type="number" value={form.valoare_eur} onChange={e => set('valoare_eur', e.target.value)} style={fieldStyle} placeholder="0" min="0" step="1000" />
            </div>
          </div>

          {/* ── Observații ──────────────────────────────────────────────── */}
          <div>
            <label style={labelStyle}>Observații</label>
            <textarea value={form.observatii} onChange={e => set('observatii', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical', minHeight: 60 }}
              placeholder="Notițe suplimentare despre proiect..." />
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={form.activ} onChange={e => set('activ', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: G.text, fontWeight: 600 }}>Proiect activ</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={form.manual_sistat} onChange={e => set('manual_sistat', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: G.yellow }} />
              <span style={{ fontSize: 13, color: form.manual_sistat ? G.yellow : G.text, fontWeight: form.manual_sistat ? 700 : 500 }}>
                💤 Sistat manual
              </span>
              {form.manual_sistat && <span style={{ fontSize: 11, color: G.muted }}>(fără ordin formal)</span>}
            </label>
          </div>

          {/* ── NAS Scanner mapping ─────────────────────────────────────── */}
          <div style={{margin:'4px 0 10px',padding:'12px 14px',background:G.bg,borderRadius:8,border:`1px solid ${G.border2}`}}>
            <div style={{...secTitle,marginBottom:10}}><span>🗂️</span> NAS Scanner — mapare folder</div>
            <div style={{display:'grid',gridTemplateColumns:'160px 1fr',gap:10}}>
              <div>
                <label style={labelStyle}>Nr. inventar NAS</label>
                <input type="number" value={form.numar_inventar} onChange={e=>set('numar_inventar',e.target.value)} style={fieldStyle} placeholder="ex: 152" min="1" />
                <div style={{fontSize:10,color:G.muted,marginTop:2}}>Numărul din față folderului NAS</div>
              </div>
              <div>
                <label style={labelStyle}>Cale folder NAS (relativ)</label>
                <input value={form.nas_folder_path} onChange={e=>set('nas_folder_path',e.target.value)} style={fieldStyle} placeholder="1.TRANSGAZ/152. LOT 2 Prunisor-Jupa" />
                <div style={{fontSize:10,color:G.muted,marginTop:2}}>AI-ul folosește numărul pentru a lega automat documentele la proiect</div>
              </div>
            </div>
          </div>

          {/* ── Persoane cheie + ISC ─────────────────────────────────────── */}
          <div style={{ borderTop:`1px solid ${G.border}`, paddingTop:14, marginBottom:4 }}>
            <div style={secTitle}><span>👥</span> Persoane cheie & ISC</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginTop:10 }}>
              {[
                { key:'mp_employee_id',  label:'MP — Manager Proiect',         emoji:'👤' },
                { key:'rte_employee_id', label:'RTE — Resp. Tehnic Execuție',  emoji:'⚙️' },
                { key:'rts_employee_id', label:'RTS — Resp. Tehnic Sudură',    emoji:'🔥' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize:10, color:G.muted, fontWeight:600, display:'block', marginBottom:4 }}>{f.emoji} {f.label}</label>
                  <select value={form[f.key]||''} onChange={e=>set(f.key, e.target.value)} style={{...fieldStyle,fontSize:12,padding:'6px 8px'}}>
                    <option value=''>— Neatribuit —</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}{emp.functie ? ` · ${emp.functie}` : ''}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop:10 }}>
              <label style={{ fontSize:10, color:G.muted, fontWeight:600, display:'block', marginBottom:4 }}>🏢 Coordonator Transgaz</label>
              <input style={{...fieldStyle,fontSize:12}} placeholder='Nume și prenume (persoana de la beneficiar)' value={form.coordonator_transgaz} onChange={e=>set('coordonator_transgaz',e.target.value)} />
            </div>
            <div style={{ marginTop:10 }}>
              <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'9px 12px', borderRadius:8, background: form.isc_faza_determinanta ? '#EF444418':'#0D1117', border:`1px solid ${form.isc_faza_determinanta?'#EF4444':'#30363D'}` }}>
                <input type='checkbox' checked={!!form.isc_faza_determinanta} onChange={e=>set('isc_faza_determinanta',e.target.checked)} style={{accentColor:'#EF4444',width:15,height:15}} />
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color: form.isc_faza_determinanta ? '#EF4444' : G.text }}>🏛️ ISC – Faza Determinantă</div>
                  <div style={{ fontSize:10, color:G.muted }}>Inspectoratul de Stat în Construcții prezent la faze determinate</div>
                </div>
              </label>
            </div>
          </div>

          {/* ── Documentație tehnică + AI ─────────────────────────────────── */}
          <div style={{ borderTop: `1px solid ${G.border}`, paddingTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={secTitle}><span>🤖</span> Documentație tehnică — extracție AI</div>
              {!isNew && (
                <button onClick={handleExtractAI} disabled={extractingAI || !Object.values(docPaths).some(v=>v)} style={{
                  padding:'6px 14px', background: extractingAI ? G.muted : G.purple,
                  border:'none', borderRadius:7, color:'#0D1117', fontSize:12,
                  cursor: extractingAI ? 'not-allowed' : 'pointer', fontWeight:700,
                  opacity: (extractingAI || !Object.values(docPaths).some(v=>v)) ? 0.6 : 1, whiteSpace:'nowrap',
                }}>
                  {extractingAI ? '⏳ AI extrage...' : '🤖 Extrage cantități'}
                </button>
              )}
            </div>

            {/* Upload 4 documente tehnice */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
              {DOC_TEHNICE.map(dt => (
                <div key={dt.key} style={{
                  display:'flex', alignItems:'center', gap:10,
                  background:G.card2, borderRadius:8, padding:'10px 12px',
                  border:`1px solid ${docPaths[dt.key] ? G.green+'55' : G.border}`,
                }}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:G.text}}>{dt.label}</div>
                    {docPaths[dt.key] ? (
                      <div style={{fontSize:10,color:G.green,marginTop:2}}>
                        ✓ Încărcat
                        <button onClick={()=>handleOpenDocTehnic(docPaths[dt.key])} style={{background:'transparent',border:'none',color:G.blue,fontSize:10,cursor:'pointer',marginLeft:8}}>📂 Deschide</button>
                      </div>
                    ) : (
                      <div style={{fontSize:10,color:G.dim,marginTop:2}}>{dt.hint}</div>
                    )}
                  </div>
                  {!isNew && (
                    <label style={{
                      padding:'5px 12px',
                      background: uploadingTehnic===dt.key ? G.muted : docPaths[dt.key] ? G.border2 : G.executie+'22',
                      border:`1px solid ${docPaths[dt.key] ? G.border : G.executie+'55'}`,
                      borderRadius:6, color:docPaths[dt.key]?G.muted:G.executie,
                      fontSize:11, cursor:uploadingTehnic===dt.key?'not-allowed':'pointer', fontWeight:600,
                      flexShrink:0, opacity:uploadingTehnic===dt.key?0.6:1,
                    }}>
                      {uploadingTehnic===dt.key ? '⏳' : docPaths[dt.key] ? '↻ Înlocuiește' : '📎 Adaugă'}
                      <input type="file" accept=".pdf" onChange={e=>{const f=e.target.files?.[0];if(f)handleUploadDocTehnic(dt.key,f);e.target.value='';}} disabled={uploadingTehnic===dt.key} style={{display:'none'}} />
                    </label>
                  )}
                </div>
              ))}
            </div>

            {/* Cantități extrase AI */}
            {(cantitati.curbe_buc!=null||cantitati.robineti_buc!=null||cantitati.flanse_electroizolate_buc!=null) && (
              <div style={{background:G.purple+'0D',borderRadius:8,padding:'12px 14px',border:`1px solid ${G.purple}33`}}>
                <div style={{fontSize:11,color:G.purple,fontWeight:700,marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                  🤖 Cantități extrase AI
                  {cantitati.docs_ai_confidence>0 && <span style={{background:G.purple+'22',padding:'1px 8px',borderRadius:10,fontSize:10}}>{cantitati.docs_ai_confidence}% conf.</span>}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                  {[{label:'Curbe',value:cantitati.curbe_buc,icon:'🔄',color:G.teal},{label:'Robineți',value:cantitati.robineti_buc,icon:'🔩',color:G.orange},{label:'Flanșe EI',value:cantitati.flanse_electroizolate_buc,icon:'⚡',color:G.yellow}].map((k,i)=>(
                    <div key={i} style={{textAlign:'center',padding:'8px 0'}}>
                      <div style={{fontSize:18}}>{k.icon}</div>
                      <div style={{fontSize:16,fontWeight:800,color:k.color}}>{k.value??'—'}</div>
                      <div style={{fontSize:10,color:G.muted}}>{k.label} · buc</div>
                    </div>
                  ))}
                </div>
                {cantitati.alte_materiale?.length>0 && (
                  <div style={{marginTop:10,borderTop:`1px solid ${G.border}`,paddingTop:8}}>
                    <div style={{fontSize:10,color:G.muted,marginBottom:5}}>Alte materiale:</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {cantitati.alte_materiale.map((m,i)=>(
                        <span key={i} style={{background:G.card2,border:`1px solid ${G.border}`,borderRadius:6,padding:'2px 8px',fontSize:10}}>
                          {m.denumire}: <strong>{m.cantitate} {m.um}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {isNew && <div style={{fontSize:11,color:G.dim,fontStyle:'italic',padding:'6px 0'}}>💡 Salvați proiectul mai întâi, apoi adăugați documentele tehnice.</div>}

            {/* ITP AI — buton + rezultate */}
            {!isNew && docPaths.itp_pccvi && (
              <div style={{ marginTop:10, padding:'12px 14px', background:'#0D1117', border:`1px solid ${form.isc_faza_determinanta?'#EF444444':G.border}`, borderRadius:9 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: itpAI.confidence>0 ? 10 : 0 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:G.text }}>🔍 Analiză AI — ITP-PCCVI</div>
                  <button onClick={handleExtractITP} disabled={extractingITP} style={{
                    padding:'5px 12px', background: extractingITP ? G.muted : '#EF4444',
                    border:'none', borderRadius:6, color:'#fff', fontSize:11,
                    cursor: extractingITP ? 'not-allowed' : 'pointer', fontWeight:700,
                    opacity: extractingITP ? 0.6 : 1,
                  }}>
                    {extractingITP ? '⏳ Analizez...' : '🔬 Extrage participanți'}
                  </button>
                </div>
                {itpAI.confidence > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, fontSize:11 }}>
                    <span style={{ padding:'3px 8px', borderRadius:8, background:'#2DD4BF22', color:'#2DD4BF', fontWeight:700 }}>
                      📊 {itpAI.faze_det} FD-uri ISC
                    </span>
                    <span style={{ padding:'3px 8px', borderRadius:8, background:G.purple+'22', color:G.purple, fontWeight:700 }}>
                      {itpAI.confidence}% confidence
                    </span>
                    {itpAI.participants.map(p => (
                      <span key={p} style={{ padding:'3px 8px', borderRadius:8, background:G.card2, color:G.text, fontWeight:600 }}>{p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Documente anexă la contract ─────────────────────────────── */}
          <div style={{ borderTop: `1px solid ${G.border}`, paddingTop: 14 }}>
            <div style={{ ...secTitle, marginBottom: 12 }}>
              <span>📎</span> Documente anexă la contract
              {!isNew && docsContract.length > 0 && (
                <span style={{ marginLeft: 4, background: G.executie + '22', color: G.executie, borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>
                  {docsContract.length}
                </span>
              )}
            </div>

            {isNew ? (
              <div style={{
                background: G.card2, border: `1px dashed ${G.border}`, borderRadius: 8,
                padding: '14px 16px', fontSize: 12, color: G.muted, textAlign: 'center',
              }}>
                💾 Salvați proiectul mai întâi, apoi adăugați documentele contractuale.
              </div>
            ) : (
              <>
                {/* Bar upload */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <select
                    value={uploadTip}
                    onChange={e => setUploadTip(e.target.value)}
                    style={{ ...fieldStyle, flex: 1 }}
                  >
                    {TIPURI_DOC_CONTRACT.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <label style={{
                    padding: '9px 16px', background: uploadingDoc ? G.muted : G.executie,
                    border: 'none', borderRadius: 7, color: '#0D1117', fontSize: 13,
                    cursor: uploadingDoc ? 'not-allowed' : 'pointer', fontWeight: 700,
                    whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                    opacity: uploadingDoc ? 0.65 : 1,
                  }}>
                    {uploadingDoc ? '⏳ Upload...' : '📎 Adaugă'}
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                      onChange={handleUploadDoc}
                      disabled={uploadingDoc}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>

                {/* Lista documente */}
                {docsContract.length === 0 ? (
                  <div style={{
                    background: G.card2, borderRadius: 8, padding: '12px 14px',
                    fontSize: 12, color: G.dim, textAlign: 'center', fontStyle: 'italic',
                  }}>
                    Niciun document adăugat încă.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                    {docsContract.map(doc => {
                      const tipLabel = TIPURI_DOC_CONTRACT.find(t => t.value === doc.tip_document)?.label || doc.tip_document
                      const sizeKB = doc.fisier_size_bytes ? ` · ${(doc.fisier_size_bytes / 1024).toFixed(0)} KB` : ''
                      return (
                        <div key={doc.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: G.card2, borderRadius: 8, padding: '9px 12px',
                          border: `1px solid ${G.border}`,
                        }}>
                          <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: G.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {doc.fisier_nume}
                            </div>
                            <div style={{ fontSize: 10, color: G.muted, marginTop: 2 }}>
                              {tipLabel}{sizeKB}
                            </div>
                          </div>
                          <button
                            onClick={() => handleOpenDoc(doc.fisier_path)}
                            style={{
                              background: G.executie + '22', border: `1px solid ${G.executie}44`,
                              borderRadius: 6, color: G.executie, fontSize: 11,
                              cursor: 'pointer', padding: '4px 10px', fontWeight: 600, flexShrink: 0,
                            }}>📂</button>
                          <button
                            onClick={() => handleDeleteDoc(doc)}
                            style={{
                              background: 'transparent', border: 'none', color: G.red,
                              fontSize: 16, cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
                            }}>🗑</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {!isNew && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${G.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: G.text, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📋</span> Catalog deviz — articole de contract
              </div>
              <div style={{ fontSize: 11, color: G.dim, marginBottom: 6 }}>
                Importă antemăsurătoarea (F3) — activitățile + cantitățile de contract, baza pentru raportul zilnic pe activități și progresul cumulat.
              </div>
              <CatalogDevizPanel proiectId={proiect.id} showToast={showToast} />

              <div style={{ fontSize: 13, fontWeight: 700, color: G.text, margin: '18px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🔧</span> Activități de raport (vocabularul echipei)
              </div>
              <div style={{ fontSize: 11, color: G.dim, marginBottom: 6 }}>
                Lista de activități pe care MP-ul le alege în raportul zilnic. Fiecare poate fi legată la deviz (coduri) pentru progres cumulat vs contract.
              </div>
              <ActivitatiProiectPanel proiectId={proiect.id} showToast={showToast} />

              <div style={{ fontSize: 13, fontWeight: 700, color: G.text, margin: '18px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📏</span> Axa de raportare — tronsoane / obiecte
              </div>
              <div style={{ fontSize: 11, color: G.dim, marginBottom: 6 }}>
                Unde se împarte lucrarea. Apar în raportul zilnic la „unde s-a lucrat", ca progresul să fie legat de loc, nu doar de proiect.
              </div>
              <UnitatiProiectPanel proiectId={proiect.id} showToast={showToast} />

              <div style={{ fontSize: 13, fontWeight: 700, color: G.text, margin: '18px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📦</span> Materiale — extras C6 (necesar din ofertă)
              </div>
              <div style={{ fontSize: 11, color: G.dim, marginBottom: 6 }}>
                Lista consumurilor de resurse materiale din ofertă. Bifează ce s-a comandat înainte de ERP; comenzile noi se leagă automat prin Achiziții (proiect pe comandă).
              </div>
              <MaterialeProiectPanel proiectId={proiect.id} showToast={showToast} />
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${G.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end', background: G.bg,
          position: 'sticky', bottom: 0,
        }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: G.border, border: 'none', borderRadius: 7, color: G.text, fontSize: 13, cursor: 'pointer' }}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '9px 18px', background: saving ? G.muted : G.executie, border: 'none',
            borderRadius: 7, color: '#0D1117', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700,
          }}>{saving ? 'Se salvează...' : isNew ? '＋ Crează proiect' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// FAZE DETERMINANTE ISC (11.06.2026) — checklist convocări per proiect
// Lista extrasă cu AI din PCCVI (edge: parse-pccvi-faze) sau adăugată manual.
// Flux status: neplanificată → planificată → convocată → efectuată (PV).
// ══════════════════════════════════════════════════════════════════════════
function FazeDeterminanteISC({ proiect }) {
  const [faze, setFaze] = useState([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [collapsed, setCollapsed] = useState(true)   // 11.06: roll up/down — implicit pliat
  const [catFilter, setCatFilter] = useState('')      // filtru pe sistem ([CONDUCTĂ] etc.)
  const [pdfPath, setPdfPath] = useState(proiect.doc_itp_pccvi_path || null)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState(null)
  const flash = (m, err) => { setMsg({ m, err }); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    const { data } = await supabase.from('executie_faze_determinante')
      .select('*').eq('proiect_id', proiect.id)
      .order('nr_faza', { ascending: true, nullsFirst: false }).order('id')
    setFaze(data || []); setLoading(false)
  }, [proiect.id])
  useEffect(() => { load() }, [load])

  const handleExtract = async (overridePath) => {
    const path = overridePath || pdfPath
    if (!path) { flash('Încarcă întâi PCCVI-ul (butonul 📎 de aici)', true); return }
    setExtracting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-pccvi-faze`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proiect_id: proiect.id, pdf_path: path }),
      })
      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || `HTTP ${resp.status}`)
      flash(`🤖 ${result.extrase} faze extrase din PCCVI (confidence ${result.confidence}%)`)
      load()
    } catch (e) { flash('Extracție eșuată: ' + e.message, true) }
    setExtracting(false)
  }

  // 11.06: shortcut PCCVI direct din dashboard — upload + extracție într-un pas
  const handleUploadPccvi = async (file) => {
    if (!file) return
    if (file.type !== 'application/pdf') { flash('Doar fișiere PDF', true); return }
    if (file.size > 10 * 1024 * 1024) { flash('PDF prea mare (max 10MB)', true); return }
    setUploading(true)
    try {
      const path = `pccvi/${proiect.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await supabase.storage.from('executie-contracte').upload(path, file, { upsert: false })
      if (upErr) throw new Error('Upload: ' + upErr.message)
      const { error: dbErr } = await supabase.from('executie_proiecte').update({ doc_itp_pccvi_path: path }).eq('id', proiect.id)
      if (dbErr) throw new Error(dbErr.message)
      setPdfPath(path)
      flash('📎 PCCVI încărcat — pornesc extracția AI...')
      setUploading(false)
      await handleExtract(path)
      return
    } catch (e) { flash('Eroare PCCVI: ' + e.message, true) }
    setUploading(false)
  }
  const handleOpenPccvi = async () => {
    if (!pdfPath) return
    const { data } = await supabase.storage.from('executie-contracte').createSignedUrl(pdfPath, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const azi = () => new Date().toISOString().slice(0, 10)
  const NEXT = {
    neplanificata: { label: '📅 Planifică', to: 'planificata', set: { data_planificata: null } },
    planificata:   { label: '📣 Convoacă ISC', to: 'convocata', set: { data_convocata: null } },
    convocata:     { label: '✅ PV efectuat', to: 'efectuata', set: { data_efectuata: null } },
  }
  const advance = async (f) => {
    const n = NEXT[f.status]; if (!n) return
    const patch = { status: n.to, updated_at: new Date().toISOString() }
    for (const k of Object.keys(n.set)) patch[k] = azi()
    const { error } = await supabase.from('executie_faze_determinante').update(patch).eq('id', f.id)
    if (error) flash('Eroare: ' + error.message, true); else load()
  }
  const addManual = async () => {
    const den = window.prompt('Denumirea fazei determinante:')
    if (!den || !den.trim()) return
    const { error } = await supabase.from('executie_faze_determinante').insert({
      proiect_id: proiect.id, denumire: den.trim().slice(0, 250),
      nr_faza: faze.length + 1, status: 'neplanificata', sursa: 'manual',
    })
    if (error) flash('Eroare: ' + error.message, true)
    else {
      await supabase.from('executie_proiecte').update({ isc_faza_determinanta: true, doc_itp_ai_faze_det: faze.length + 1 }).eq('id', proiect.id)
      load()
    }
  }
  const remove = async (f) => {
    if (!window.confirm(`Șterge faza „${f.denumire}"?`)) return
    const { error } = await supabase.from('executie_faze_determinante').delete().eq('id', f.id)
    if (error) flash('Eroare: ' + error.message, true); else load()
  }

  const ST = {
    neplanificata: { c: '#EF4444', l: 'NEPLANIFICATĂ' },
    planificata:   { c: '#F0883E', l: 'PLANIFICATĂ' },
    convocata:     { c: '#58A6FF', l: 'CONVOCATĂ' },
    efectuata:     { c: '#3FB950', l: 'EFECTUATĂ ✓' },
    anulata:       { c: '#8B949E', l: 'ANULATĂ' },
  }
  const restante = faze.filter(f => f.status === 'neplanificata' || f.status === 'planificata').length
  const catOf = d => { const m = /^\[([^\]]+)\]/.exec(d || ''); return m ? m[1] : 'ALTE' }
  const categorii = [...new Set(faze.map(f => catOf(f.denumire)))]
    .sort((a, b) => (a === 'CONDUCTĂ' ? -1 : b === 'CONDUCTĂ' ? 1 : a.localeCompare(b, 'ro')))
  const fazeVizibile = catFilter ? faze.filter(f => catOf(f.denumire) === catFilter) : faze
  const restanteCat = cat => faze.filter(f => catOf(f.denumire) === cat && (f.status === 'neplanificata' || f.status === 'planificata')).length

  return (
    <div style={{ marginTop: 10, padding: '12px 14px', background: '#EF444410', borderRadius: 8, border: '1px solid #EF444433' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: (!collapsed && faze.length > 0) ? 10 : 0 }}>
        <span style={{ fontSize: 18 }}>🏛️</span>
        <div onClick={() => setCollapsed(c => !c)}
          style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', cursor: 'pointer', userSelect: 'none' }}
          title={collapsed ? 'Click pentru a desfășura lista' : 'Click pentru a plia lista'}>
          {collapsed ? '▸' : '▾'} Faze determinante ISC {faze.length > 0 && `(${faze.length})`}
        </div>
        {restante > 0 && (
          <span style={{ fontSize: 10, fontWeight: 800, color: '#F0883E', padding: '2px 8px', background: '#F0883E22', borderRadius: 8 }}>
            ⚠️ {restante} de convocat
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <label style={{ padding: '8px 13px', fontSize: 13, fontWeight: 700, background: 'transparent', color: '#58A6FF', border: '1px solid #58A6FF66', borderRadius: 8, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? .6 : 1 }}
            title={pdfPath ? 'Înlocuiește PCCVI-ul și re-extrage' : 'Încarcă PCCVI-ul și extrage fazele automat'}>
            {uploading ? '⏳ Se încarcă...' : pdfPath ? '↻ Înlocuiește PCCVI' : '📎 Încarcă PCCVI + extrage'}
            <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploading || extracting}
              onChange={e => { handleUploadPccvi(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {pdfPath && (
            <button onClick={handleOpenPccvi}
              style={{ padding: '8px 13px', fontSize: 13, fontWeight: 700, background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer' }}>
              📂 Deschide
            </button>
          )}
          <button onClick={() => handleExtract()} disabled={extracting || uploading}
            style={{ padding: '8px 13px', fontSize: 13, fontWeight: 700, background: 'transparent', color: '#BC8CFF', border: '1px solid #BC8CFF66', borderRadius: 8, cursor: extracting ? 'wait' : 'pointer', opacity: extracting ? .6 : 1 }}>
            {extracting ? '🤖 AI citește PCCVI...' : '🤖 Re-extrage'}
          </button>
          <button onClick={addManual}
            style={{ padding: '8px 13px', fontSize: 13, fontWeight: 700, background: 'transparent', color: G.muted, border: `1px solid ${G.border}`, borderRadius: 8, cursor: 'pointer' }}>
            + Manual
          </button>
        </div>
      </div>
      {msg && <div style={{ fontSize: 11, fontWeight: 700, color: msg.err ? '#EF4444' : '#3FB950', marginBottom: 8 }}>{msg.m}</div>}
      {!collapsed && faze.length > 0 && categorii.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setCatFilter('')}
            style={{ padding: '7px 12px', fontSize: 11.5, fontWeight: 800, borderRadius: 16, cursor: 'pointer',
              background: !catFilter ? '#EF444422' : 'transparent', color: !catFilter ? '#EF4444' : G.muted,
              border: `1px solid ${!catFilter ? '#EF4444' : G.border}` }}>
            Toate ({faze.length})
          </button>
          {categorii.map(cat => (
            <button key={cat} onClick={() => setCatFilter(catFilter === cat ? '' : cat)}
              style={{ padding: '7px 12px', fontSize: 11.5, fontWeight: 800, borderRadius: 16, cursor: 'pointer',
                background: catFilter === cat ? '#EF444422' : 'transparent', color: catFilter === cat ? '#EF4444' : G.muted,
                border: `1px solid ${catFilter === cat ? '#EF4444' : G.border}` }}>
              {cat === 'CONDUCTĂ' ? '🔥 ' : ''}{cat} ({faze.filter(f => catOf(f.denumire) === cat).length}{restanteCat(cat) > 0 ? ` · ⚠${restanteCat(cat)}` : ''})
            </button>
          ))}
        </div>
      )}
      {collapsed ? null : loading ? (
        <div style={{ fontSize: 11, color: G.muted }}>⏳ ...</div>
      ) : faze.length === 0 ? (
        <div style={{ fontSize: 11, color: G.muted, marginTop: 6 }}>
          Nicio fază în listă. {pdfPath ? 'Apasă „🤖 Re-extrage" sau adaugă manual.' : 'Apasă „📎 Încarcă PCCVI + extrage" — totul dintr-un pas.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fazeVizibile.map(f => {
            const st = ST[f.status] || ST.neplanificata
            const next = NEXT[f.status]
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: G.bg, borderRadius: 7, border: `1px solid ${st.c}33`, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: st.c, padding: '3px 8px', background: st.c + '22', borderRadius: 8, whiteSpace: 'nowrap' }}>{st.l}</span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: G.text }}>
                    {f.nr_faza ? `${f.nr_faza}. ` : ''}{f.denumire}
                    {f.sursa === 'ai_pccvi' && <span style={{ fontSize: 9, color: '#BC8CFF', marginLeft: 6 }}>🤖</span>}
                  </div>
                  <div style={{ fontSize: 10, color: G.muted }}>
                    {f.stadiu_fizic ? `${f.stadiu_fizic} · ` : ''}
                    {f.participanti ? `${f.participanti} · ` : ''}
                    {f.data_convocata ? `convocat ${f.data_convocata} · ` : ''}
                    {f.data_efectuata ? `PV ${f.data_efectuata}` : ''}
                  </div>
                </div>
                {next && (
                  <button onClick={() => advance(f)}
                    style={{ padding: '8px 13px', fontSize: 12, fontWeight: 700, background: st.c + '22', color: st.c, border: `1px solid ${st.c}55`, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {next.label}
                  </button>
                )}
                <button onClick={() => remove(f)} title="Șterge"
                  style={{ padding: '8px 11px', fontSize: 14, background: 'transparent', color: '#EF4444', border: '1px solid #EF444444', borderRadius: 8, cursor: 'pointer' }}>🗑</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// TAB PROIECT — DASHBOARD (11.06.2026): pagina de aterizare la deschiderea
// unui proiect: date contract, echipă (MP/RTE/RTS/Transgaz), faze ISC, stadiu.
// ══════════════════════════════════════════════════════════════════════════
function TabProiectDashboard({ proiectId }) {
  const [p, setP] = useState(null)
  const [extra, setExtra] = useState(null)
  const [personnel, setPersonnel] = useState({})
  const [editEchipa, setEditEchipa] = useState(false)
  const [angajati, setAngajati] = useState([])
  const [echipaForm, setEchipaForm] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!proiectId) return
    let live = true
    ;(async () => {
      const [{ data: v }, { data: e }] = await Promise.all([
        supabase.from('v_executie_dashboard').select('*').eq('id', proiectId).maybeSingle(),
        supabase.from('executie_proiecte')
          .select('mp_employee_id, rts_employee_id, rte_employee_id, coordonator_transgaz, doc_itp_pccvi_path, isc_faza_determinanta, lungime_proiect_m')
          .eq('id', proiectId).maybeSingle(),
      ])
      if (!live) return
      setP(v || null); setExtra(e || null)
      const ids = [e?.mp_employee_id, e?.rts_employee_id, e?.rte_employee_id].filter(Boolean)
      if (ids.length) {
        const { data } = await supabase.from('employees').select('id, name, functie').in('id', ids)
        if (!live) return
        const m = {}; (data || []).forEach(x => { m[x.id] = x }); setPersonnel(m)
      }
    })()
    return () => { live = false }
  }, [proiectId, reloadKey])

  // Editor echipă cheie (11.06): shortcut direct din dashboard, fără modalul mare
  const openEchipaEdit = async () => {
    if (!angajati.length) {
      const { data } = await supabase.from('employees').select('id, name, functie').eq('activ', true).order('name')
      setAngajati(data || [])
    }
    setEchipaForm({
      mp_employee_id: extra.mp_employee_id || '',
      rte_employee_id: extra.rte_employee_id || '',
      rts_employee_id: extra.rts_employee_id || '',
      coordonator_transgaz: extra.coordonator_transgaz || '',
    })
    setEditEchipa(true)
  }
  const saveEchipa = async () => {
    const { error } = await supabase.from('executie_proiecte').update({
      mp_employee_id: echipaForm.mp_employee_id ? Number(echipaForm.mp_employee_id) : null,
      rte_employee_id: echipaForm.rte_employee_id ? Number(echipaForm.rte_employee_id) : null,
      rts_employee_id: echipaForm.rts_employee_id ? Number(echipaForm.rts_employee_id) : null,
      coordonator_transgaz: echipaForm.coordonator_transgaz || null,
    }).eq('id', proiectId)
    if (error) { alert('Eroare: ' + error.message); return }
    setEditEchipa(false); setReloadKey(k => k + 1)
  }
  const editLungimeProiect = async () => {
    const v = window.prompt('Lungimea conductei conform CONTRACT/proiect (metri):', extra.lungime_proiect_m || '')
    if (v === null) return
    const n = parseFloat(String(v).replace(',', '.'))
    const { error } = await supabase.from('executie_proiecte')
      .update({ lungime_proiect_m: isFinite(n) && n > 0 ? n : null }).eq('id', proiectId)
    if (error) alert('Eroare: ' + error.message); else setReloadKey(k => k + 1)
  }

  if (!p || !extra) return <div style={{ padding: 40, textAlign: 'center', color: G.muted, fontSize: 13 }}>⏳ Se încarcă proiectul...</div>

  const pz = { ...p, ...extra }
  const echipa = [
    { label: 'Manager Proiect (MP)',        id: extra.mp_employee_id },
    { label: 'Resp. Tehnic Execuție (RTE)', id: extra.rte_employee_id },
    { label: 'Resp. Tehnic Sudură (RTS)',   id: extra.rts_employee_id },
    { label: 'Coordonator Transgaz',        val: extra.coordonator_transgaz },
  ].filter(r => r.id || r.val)

  const infoRows = [
    { label: 'Ordin de începere', value: p.data_start ? fmtDate(p.data_start) : '⚠️ nesetat', warn: !p.data_start },
    { label: 'Termen finalizare', value: p.este_sistat
        ? `⏸ Sistat (${p.data_ultima_sistare ? fmtDate(p.data_ultima_sistare) : 'manual'})`
        : (p.data_termen ? fmtDate(p.data_termen) + (p.prelungire_totala_luni > 0 ? ` +${p.prelungire_totala_luni}l AA` : '') : '—'),
      warn: p.zile_pana_termen != null && p.zile_pana_termen < 30 && !p.este_sistat },
    { label: 'Zile până la termen', value: p.zile_pana_termen != null ? `${p.zile_pana_termen} zile` : '—', warn: p.zile_pana_termen != null && p.zile_pana_termen < 30 },
    { label: 'Valoare contract', value: p.valoare_lei ? fmtLei(p.valoare_lei) : '—' },
    { label: 'Nr. contract', value: p.nr_contract || p.numar_contract || '—' },
    { label: 'Acte adiționale', value: p.nr_acte_aditionale > 0 ? `${p.nr_acte_aditionale} acte` : '—' },
  ]

  const lungProiect = Number(extra.lungime_proiect_m) || 0
  const lungExecutat = Number(p.lungime_totala_m) || 0
  const pctLung = lungProiect > 0 ? Math.min(100, (lungExecutat / lungProiect) * 100) : null
  const stadiu = [
    { label: 'Tronsoane', value: p.nr_tronsoane ?? 0 },
    { label: 'Pachete lansare', value: p.nr_pachete ?? 0 },
    { label: 'Lungime proiect (contract)', value: lungProiect > 0 ? `${lungProiect.toLocaleString('ro-RO')} m` : '✏️ setează', onClick: editLungimeProiect },
    { label: 'Executat (izometrie)', value: lungExecutat > 0 ? `${lungExecutat.toLocaleString('ro-RO')} m${pctLung !== null ? ` · ${pctLung.toFixed(1)}%` : ''}` : '—' },
    { label: 'Zile-om pontaj', value: p.pontaj_zile_om ?? 0 },
    { label: 'Angajați distincți', value: p.pontaj_angajati ?? 0 },
    { label: 'Ultima zi pontată', value: p.pontaj_ultima_zi ? fmtDate(p.pontaj_ultima_zi) : '—' },
  ]

  return (
    <div className="fi">
      {/* Info contract */}
      <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 12 }}>
          📋 Date contract & termene
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {infoRows.map((row, i) => (
            <div key={i} style={{ background: G.card2 || G.surface, borderRadius: 8, padding: '10px 14px', border: row.warn ? '1px solid #F0883E66' : 'none' }}>
              <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{row.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: row.warn ? '#F0883E' : G.text }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Echipă proiect */}
      <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px' }}>
            👥 Echipă proiect — responsabili execuție
          </div>
          <button onClick={editEchipa ? () => setEditEchipa(false) : openEchipaEdit}
            style={{ marginLeft: 'auto', padding: '8px 13px', fontSize: 13, fontWeight: 700, background: 'transparent', color: editEchipa ? G.muted : '#58A6FF', border: `1px solid ${editEchipa ? G.border : '#58A6FF66'}`, borderRadius: 8, cursor: 'pointer' }}>
            {editEchipa ? '✕ Renunță' : '✏️ Editează echipa'}
          </button>
        </div>
        {editEchipa && echipaForm ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {[
              { k: 'mp_employee_id', label: 'Manager Proiect (MP)' },
              { k: 'rte_employee_id', label: 'Resp. Tehnic Execuție (RTE)' },
              { k: 'rts_employee_id', label: 'Resp. Tehnic Sudură (RTS)' },
            ].map(f => (
              <div key={f.k}>
                <div style={{ fontSize: 9, color: G.muted, textTransform: 'uppercase', marginBottom: 3 }}>{f.label}</div>
                <select value={echipaForm[f.k]} onChange={e => setEchipaForm(pr => ({ ...pr, [f.k]: e.target.value }))}
                  style={{ width: '100%', padding: '9px 10px', fontSize: 13, background: G.card2 || G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7 }}>
                  <option value="">— fără —</option>
                  {angajati.map(a => <option key={a.id} value={a.id}>{a.name}{a.functie ? ` (${a.functie})` : ''}</option>)}
                </select>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 9, color: G.muted, textTransform: 'uppercase', marginBottom: 3 }}>Coordonator Transgaz</div>
              <input value={echipaForm.coordonator_transgaz} onChange={e => setEchipaForm(pr => ({ ...pr, coordonator_transgaz: e.target.value }))}
                placeholder="nume coordonator" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', fontSize: 13, background: G.card2 || G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={saveEchipa} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 800, background: '#3FB950', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>✓ Salvează echipa</button>
            </div>
          </div>
        ) : echipa.length === 0 ? (
          <div style={{ fontSize: 12, color: G.muted, fontStyle: 'italic' }}>Niciun responsabil setat — apasă „✏️ Editează echipa" și completează MP / RTE / RTS / coordonator Transgaz.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {echipa.map((r, i) => (
              <div key={i} style={{ background: G.card2 || G.surface, borderRadius: 7, padding: '10px 14px' }}>
                <div style={{ fontSize: 9, color: G.muted, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{r.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>{r.val || personnel[r.id]?.name || '⏳'}</div>
                {r.id && personnel[r.id]?.functie && <div style={{ fontSize: 10, color: G.muted }}>{personnel[r.id].functie}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Faze determinante ISC — checklist complet (extract AI din PCCVI) */}
      <FazeDeterminanteISC proiect={pz} />

      {/* Stadiu execuție + pontaj */}
      <div style={{ background: G.bg, borderRadius: 10, padding: '14px 16px', marginTop: 14 }}>
        <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 12 }}>
          📊 Stadiu execuție & pontaj
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {stadiu.map((s, i) => (
            <div key={i} onClick={s.onClick} title={s.onClick ? 'Click pentru editare' : undefined}
              style={{ background: G.card2 || G.surface, borderRadius: 8, padding: '10px 14px', cursor: s.onClick ? 'pointer' : 'default', border: s.onClick ? `1px dashed ${G.border}` : 'none' }}>
              <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENTE CALITATE MATERIALE (12.06.2026) — certificatele/declarațiile de
// conformitate încărcate pe comenzile furnizor în Achiziții, filtrate pe
// proiectul curent. Sursa: comenzi_furnizor_documente (tip=calitate).
// ════════════════════════════════════════════════════════════════════════════
function DocCalitateMaterialeSection({ proiectId }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // Query-uri separate (fără FK implicit joins): comenzile proiectului → documentele lor
        const { data: cmds } = await supabase.from('comenzi_furnizor')
          .select('id, numar_comanda, furnizor_id').eq('proiect_id', proiectId)
        const ids = (cmds || []).map(c => c.id)
        if (!ids.length) { setDocs([]); return }
        // Toate documentele de calitate (nu doar certificatele): certificat 3.1 +
        // declarație conformitate + aviz — tipurile noi din 05.08.2026. Facturile NU.
        const [rDocs, rFz] = await Promise.all([
          supabase.from('comenzi_furnizor_documente').select('*').in('tip', ['calitate', 'declaratie', 'aviz']).in('comanda_id', ids).order('uploadat_la', { ascending: false }),
          supabase.from('logistica_furnizori').select('id, nume'),
        ])
        const cmdMap = Object.fromEntries((cmds || []).map(c => [c.id, c]))
        const fzMap = Object.fromEntries((rFz.data || []).map(f => [f.id, f.nume]))
        setDocs((rDocs.data || []).map(d => ({
          ...d,
          _cmd: cmdMap[d.comanda_id]?.numar_comanda || `#${d.comanda_id}`,
          _furnizor: fzMap[cmdMap[d.comanda_id]?.furnizor_id] || '—',
        })))
      } finally { setLoading(false) }
    })()
  }, [proiectId])

  const openDoc = async (path) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const downloadDoc = async (path, nume) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120, { download: nume || true })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const EMOJI_TIP = { calitate: '🏅', declaratie: '📜', aviz: '🚚' }

  if (loading) return null
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: docs.length ? 10 : 0 }}>
        <span style={{ fontSize: 17 }}>🏅</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>Documente calitate materiale</span>
        <span style={{ fontSize: 11, color: G.muted }}>· din comenzile furnizor (Achiziții)</span>
        {docs.length > 0 && <span style={{ background: G.green + '22', color: G.green, border: `1px solid ${G.green}55`, borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>{docs.length}</span>}
        {!docs.length && <span style={{ fontSize: 11.5, color: G.dim, fontStyle: 'italic', marginLeft: 'auto' }}>Niciun document încă — se încarcă pe comandă în Achiziții.</span>}
      </div>
      {docs.map(d => (
        <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 160px 110px 140px', gap: 10, alignItems: 'center', padding: '8px 4px', borderTop: `1px solid ${G.border}`, fontSize: 12.5 }}>
          <button onClick={() => openDoc(d.fisier_path)} title={d.fisier_nume}
            style={{ background: 'none', border: 'none', color: G.green, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {EMOJI_TIP[d.tip] || '📄'} {d.fisier_nume || d.fisier_path.split('/').pop()}
          </button>
          <a href={`/achizitii?id=${d.comanda_id}`} style={{ color: G.muted, fontSize: 11.5, fontFamily: 'monospace', textDecoration: 'none' }} title="Deschide comanda">🛒 {d._cmd}</a>
          <span style={{ color: G.muted, fontSize: 11.5 }}>🏭 {d._furnizor}</span>
          <span style={{ color: G.dim, fontSize: 11 }}>{d.uploadat_la ? new Date(d.uploadat_la).toLocaleDateString('ro-RO') : '—'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => openDoc(d.fisier_path)} style={{ padding: '4px 10px', background: G.green + '22', border: `1px solid ${G.green}44`, borderRadius: 6, color: G.green, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>👁 Vezi</button>
            <button onClick={() => downloadDoc(d.fisier_path, d.fisier_nume)} title="Descarcă" style={{ padding: '4px 10px', background: '#58A6FF22', border: '1px solid #58A6FF44', borderRadius: 6, color: '#58A6FF', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>⬇</button>
          </div>
        </div>
      ))}
    </div>
  )
}

