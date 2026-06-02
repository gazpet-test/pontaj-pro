// ===========================================================================
// MODUL EXECUȚIE — Dashboard Proiecte + Sub-tab navigation
// ===========================================================================
// 20.05.2026 — FAZA 1: sub-tab shell
// 02.06.2026 — FAZA A: dashboard proiecte (durata/termen/stadiu) — DEFAULT TAB
//   • Tab „🗂️ Proiecte" ACTIV — dashboard KPI per proiect, editare proprietar
//   • Tab „📐 Izometrie" ACTIV — pachete lansare țeavă, tronsoane, cumulat
//   • Tab „🏗️ Șantiere" placeholder (Faza B — alocare personal/utilaje pe tură)
//   • Tab „📋 Devize" placeholder (Faza C)
//   • Tab „☁️ Vreme live" placeholder (Faza D)
// URL deep-link: /executie?tab=proiecte | izometrie | santiere | devize | vreme
// ===========================================================================

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import IzometriePage from './Izometrie.jsx'
import TabSantiere from './TabSantiere.jsx'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ---------------------------------------------------------------------------
// Theme G — consistent cu restul modulelor
// ---------------------------------------------------------------------------
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', teal:'#2DD4BF', pink:'#F778BA',
  executie:'#58A6FF', // accent modul Execuție
}

const fmtM = v => { // 3970.85 → "3.97 km"
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
// SUB-TAB DEFINITIONS
// ---------------------------------------------------------------------------
const SUB_TABS = [
  { key: 'proiecte',  label: 'Proiecte',     icon: '🗂️',  color: G.executie, active: true,  desc: 'Dashboard proiecte · Termene · Stadiu · Ofertare' },
  { key: 'izometrie', label: 'Izometrie',    icon: '📐',  color: G.purple,   active: true,  desc: 'Pachete lansare · Tronsoane · Cumulat final' },
  { key: 'santiere',  label: 'Șantiere',     icon: '🏗️', color: G.blue,     active: true, desc: 'Echipe pe tură · Alocare utilaje · Progres activități' },
  { key: 'devize',    label: 'Devize',       icon: '📋',  color: G.green,    active: false, desc: 'Devize ofertă · Antemăsurători · Estimări' },
  { key: 'vreme',     label: 'Vreme live',   icon: '☁️',  color: G.yellow,   active: false, desc: 'Prognoză 7 zile · Alerte meteo per șantier' },
]

// ===========================================================================
// MAIN COMPONENT — ExecutiePage (shell)
// ===========================================================================
export default function ExecutiePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initTab = searchParams.get('tab') || 'proiecte'
  const [tab, setTab] = useState(initTab)

  useEffect(() => {
    const current = searchParams.get('tab')
    if (current !== tab) setSearchParams({ tab }, { replace: true })
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && urlTab !== tab) setTab(urlTab)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTabDef = SUB_TABS.find(t => t.key === tab) || SUB_TABS[0]
  const isPlaceholder = !activeTabDef.active

  const goToIzometrie = () => setTab('izometrie')

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>
      {/* ─────────── SUB-TAB NAVIGATION (sticky) ─────────── */}
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
              <div style={{ fontSize: 10, color: G.muted, marginTop: -1 }}>Sub-module operaționale</div>
            </div>
          </div>

          {/* Tab buttons */}
          {SUB_TABS.map(t => {
            const isActive = tab === t.key
            const disabled = !t.active
            return (
              <button
                key={t.key}
                onClick={() => !disabled && setTab(t.key)}
                disabled={disabled}
                title={disabled ? `${t.label} — disponibil în Faza viitoare` : t.desc}
                style={{
                  padding: '14px 16px', background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${isActive ? t.color : 'transparent'}`,
                  color: disabled ? G.dim : isActive ? t.color : G.text,
                  cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13,
                  fontWeight: isActive ? 700 : 500, transition: 'all .15s ease',
                  display: 'flex', alignItems: 'center', gap: 7,
                  opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', flexShrink: 0,
                }}
                onMouseEnter={e => { if (!disabled && !isActive) e.currentTarget.style.color = t.color }}
                onMouseLeave={e => { if (!disabled && !isActive) e.currentTarget.style.color = G.text }}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {t.label}
                {disabled && (
                  <span style={{
                    fontSize: 9, padding: '2px 5px', background: G.border2, color: G.muted,
                    borderRadius: 4, marginLeft: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px',
                  }}>soon</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ─────────── CONTENT ─────────── */}
      {isPlaceholder ? (
        <PlaceholderTab tab={activeTabDef} />
      ) : (
        <>
          {tab === 'proiecte'  && <DashboardProiectePage onGoToIzometrie={goToIzometrie} />}
          {tab === 'izometrie' && <IzometriePage />}
          {tab === 'santiere'  && <TabSantiere />}
        </>
      )}
    </div>
  )
}

// ===========================================================================
// DASHBOARD PROIECTE — Tab principal
// ===========================================================================
function DashboardProiectePage({ onGoToIzometrie }) {
  const [proiecte, setProiecte] = useState([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [selectedProiect, setSelectedProiect] = useState(null)
  const [editProiect, setEditProiect] = useState(null) // owner-only
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // Profile (pentru is_owner check)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role').eq('id', user.id).single()
        setProfile(prof)
      }
      // Dashboard data
      const { data, error } = await supabase
        .from('v_executie_dashboard')
        .select('*')
        .order('id')
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

  // Stats globale
  const totalProiecte = proiecte.length
  const proiecteActive = proiecte.filter(p => p.activ).length
  const totalLungime = proiecte.reduce((acc, p) => acc + parseFloat(p.lungime_totala_m || 0), 0)
  const totalPachete = proiecte.reduce((acc, p) => acc + (p.nr_pachete || 0), 0)
  const totalTronsoane = proiecte.reduce((acc, p) => acc + (p.nr_tronsoane || 0), 0)

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

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: G.text }}>
            🗂️ Dashboard Proiecte
          </h2>
          <div style={{ color: G.muted, fontSize: 13, marginTop: 4 }}>
            Monitorizare termene · Stadiu execuție · Linkuri ofertare și contract
          </div>
        </div>
        {isOwner && (
          <button
            onClick={() => setEditProiect({ _isNew: true, activ: true })}
            style={{
              padding: '9px 18px', background: G.executie, border: 'none',
              borderRadius: 8, color: '#0D1117', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            ＋ Proiect nou
          </button>
        )}
      </div>

      {/* ─── KPI GLOBALE ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Proiecte active', value: `${proiecteActive}/${totalProiecte}`, icon: '📁', color: G.executie },
          { label: 'Tronsoane total', value: totalTronsoane, icon: '📏', color: G.purple },
          { label: 'Pachete lansate', value: totalPachete, icon: '📦', color: G.blue },
          { label: 'Lungime totală', value: fmtM(totalLungime), icon: '📐', color: G.teal },
        ].map((kpi, i) => (
          <div key={i} style={{
            background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10,
            padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 9,
              background: kpi.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>{kpi.icon}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value}</div>
              <div style={{ fontSize: 11, color: G.muted, marginTop: 3 }}>{kpi.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── CARDURI PROIECTE ─── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: G.muted }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Se încarcă proiectele...</div>
        </div>
      ) : proiecte.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: G.muted }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📁</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Niciun proiect înregistrat</div>
          {isOwner && (
            <div style={{ fontSize: 13 }}>
              Apasă „＋ Proiect nou" pentru a adăuga primul proiect.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: 20 }}>
          {proiecte.map(p => (
            <ProiectCard
              key={p.id}
              proiect={p}
              isOwner={isOwner}
              onDetail={() => setSelectedProiect(p)}
              onEdit={() => setEditProiect(p)}
              onGoToIzometrie={onGoToIzometrie}
            />
          ))}
        </div>
      )}

      {/* ─── MODALS ─── */}
      {selectedProiect && (
        <ProiectDetailModal
          proiect={selectedProiect}
          isOwner={isOwner}
          onClose={() => setSelectedProiect(null)}
          onEdit={() => { setEditProiect(selectedProiect); setSelectedProiect(null) }}
          onGoToIzometrie={onGoToIzometrie}
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
// PROIECT CARD
// ===========================================================================
function ProiectCard({ proiect: p, isOwner, onDetail, onEdit, onGoToIzometrie }) {
  // Calcul status termen
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
      {/* Accent top strip */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${G.executie}, ${G.purple})` }} />

      {/* Card header */}
      <div style={{ padding: '18px 20px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: G.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 4 }}>
              {p.cod_intern}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, color: G.text, lineHeight: 1.35,
              cursor: 'pointer',
            }} onClick={onDetail}>
              {p.nume}
            </div>
          </div>
          <div style={{
            padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: p.activ ? G.green + '22' : G.border,
            color: p.activ ? G.green : G.muted,
            flexShrink: 0,
          }}>
            {p.activ ? '● Activ' : '○ Inactiv'}
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

      {/* Termene */}
      <div style={{ padding: '14px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {/* Start */}
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Start</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>{fmtDate(p.data_start)}</div>
          </div>
          {/* Termen */}
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Termen</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: terminStatus?.color || G.text }}>{fmtDate(p.data_termen)}</div>
            {terminStatus && (
              <div style={{
                display: 'inline-block', marginTop: 3,
                padding: '1px 6px', borderRadius: 4,
                fontSize: 10, fontWeight: 600,
                color: terminStatus.color, background: terminStatus.bg,
              }}>{terminStatus.label}</div>
            )}
          </div>
          {/* % timp scurs */}
          <div>
            <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Timp scurs</div>
            {pct !== null ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: pctColor }}>{pct}%</div>
                <div style={{ height: 4, background: G.border, borderRadius: 2, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, borderRadius: 2, background: pctColor, transition: 'width .5s' }} />
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: G.dim }}>
                {isOwner ? (
                  <span
                    style={{ cursor: 'pointer', color: G.executie, textDecoration: 'underline dotted' }}
                    onClick={e => { e.stopPropagation(); /* setEditProiect via callback */ }}
                  >Setează date...</span>
                ) : '—'}
              </div>
            )}
          </div>
        </div>

        {/* Fara date warning */}
        {(!p.data_start || !p.data_termen) && isOwner && (
          <div style={{
            marginTop: 10, padding: '7px 10px',
            background: G.yellow + '11', border: `1px solid ${G.yellow}44`,
            borderRadius: 6, fontSize: 11, color: G.yellow,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ⚠️ Datele contractuale nu sunt completate — apasă ✏️ Editează pentru a adăuga termene.
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
          <button
            onClick={onDetail}
            style={{
              padding: '6px 12px', background: G.card2, border: `1px solid ${G.border}`,
              borderRadius: 6, color: G.text, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >🔍 Detalii</button>
          <button
            onClick={onGoToIzometrie}
            style={{
              padding: '6px 12px', background: G.purple + '22', border: `1px solid ${G.purple}55`,
              borderRadius: 6, color: G.purple, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >📐 Izometrie →</button>
        </div>
        {isOwner && (
          <button
            onClick={onEdit}
            style={{
              padding: '6px 12px', background: 'transparent', border: `1px solid ${G.border}`,
              borderRadius: 6, color: G.muted, fontSize: 12, cursor: 'pointer',
            }}
          >✏️ Editează</button>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// PROIECT DETAIL MODAL (read-only)
// ===========================================================================
function ProiectDetailModal({ proiect: p, isOwner, onClose, onEdit, onGoToIzometrie }) {
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
          {/* Info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Data start', value: fmtDate(p.data_start) },
              { label: 'Termen finalizare', value: fmtDate(p.data_termen) },
              { label: 'Valoare contract', value: p.valoare_lei ? fmtLei(p.valoare_lei) : '—' },
              { label: 'Valoare ofertă', value: p.oferta_valoare ? fmtLei(p.oferta_valoare) : '—' },
              { label: 'Nr. contract', value: p.numar_contract || '—' },
              { label: 'Data semnare', value: fmtDate(p.contract_data_semnare) },
              { label: 'Status contract', value: p.contract_status || '—' },
              { label: 'Termen contractual', value: p.contract_zile ? `${p.contract_zile} zile` : '—' },
            ].map((row, i) => (
              <div key={i} style={{ background: G.bg, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{row.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: G.text }}>{row.value}</div>
              </div>
            ))}
          </div>

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

          {/* Observatii */}
          {p.observatii && (
            <div style={{ background: G.bg, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: G.muted }}>
              <span style={{ fontWeight: 700, color: G.text }}>Observații: </span>{p.observatii}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${G.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end', background: G.bg,
        }}>
          <button onClick={onGoToIzometrie} style={{
            padding: '8px 16px', background: G.purple + '22', border: `1px solid ${G.purple}55`,
            borderRadius: 7, color: G.purple, fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}>📐 Mergi la Izometrie</button>
          {isOwner && (
            <button onClick={onEdit} style={{
              padding: '8px 16px', background: G.executie, border: 'none',
              borderRadius: 7, color: '#0D1117', fontSize: 13, cursor: 'pointer', fontWeight: 700,
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
// PROIECT EDIT MODAL (owner-only)
// ===========================================================================
function ProiectEditModal({ proiect, onClose, onSaved, showToast }) {
  const isNew = proiect._isNew === true
  const [form, setForm] = useState({
    cod_intern:  proiect.cod_intern  || '',
    nume:        proiect.nume        || '',
    beneficiar:  proiect.beneficiar  || '',
    observatii:  proiect.observatii  || '',
    data_start:  proiect.data_start  || '',
    data_termen: proiect.data_termen || '',
    valoare_lei: proiect.valoare_lei || '',
    valoare_eur: proiect.valoare_eur || '',
    site_id:     proiect.site_id     || '',
    activ:       proiect.activ !== false,
  })
  const [sites, setSites] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('sites').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setSites(data || []))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.cod_intern.trim() || !form.nume.trim()) {
      showToast('Cod intern și Nume sunt obligatorii', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        cod_intern:  form.cod_intern.trim(),
        nume:        form.nume.trim(),
        beneficiar:  form.beneficiar.trim() || null,
        observatii:  form.observatii.trim() || null,
        data_start:  form.data_start || null,
        data_termen: form.data_termen || null,
        valoare_lei: form.valoare_lei ? parseFloat(form.valoare_lei) : null,
        valoare_eur: form.valoare_eur ? parseFloat(form.valoare_eur) : null,
        site_id:     form.site_id ? parseInt(form.site_id) : null,
        activ:       form.activ,
        updated_at:  new Date().toISOString(),
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

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    background: G.bg, border: `1px solid ${G.border}`, borderRadius: 7,
    padding: '9px 12px', color: G.text, fontSize: 13, outline: 'none',
  }
  const labelStyle = { fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5, display: 'block' }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 1010,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14,
        width: '100%', maxWidth: 580, maxHeight: '85vh', overflow: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{isNew ? '＋ Proiect nou' : `✏️ Editează: ${proiect.cod_intern}`}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: G.muted, fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Cod intern *</label>
              <input value={form.cod_intern} onChange={e => set('cod_intern', e.target.value)}
                style={fieldStyle} placeholder="ex: PRUNISOR_JUPA" />
            </div>
            <div>
              <label style={labelStyle}>Beneficiar</label>
              <input value={form.beneficiar} onChange={e => set('beneficiar', e.target.value)}
                style={fieldStyle} placeholder="ex: S.N.T.G.N. TRANSGAZ S.A." />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Denumire proiect *</label>
            <input value={form.nume} onChange={e => set('nume', e.target.value)}
              style={fieldStyle} placeholder="Denumire completă a proiectului" />
          </div>

          <div>
            <label style={labelStyle}>Șantier principal</label>
            <select value={form.site_id} onChange={e => set('site_id', e.target.value)} style={fieldStyle}>
              <option value="">— Neatribuit —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Data start</label>
              <input type="date" value={form.data_start} onChange={e => set('data_start', e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Termen finalizare</label>
              <input type="date" value={form.data_termen} onChange={e => set('data_termen', e.target.value)} style={fieldStyle} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Valoare contract (RON)</label>
              <input type="number" value={form.valoare_lei} onChange={e => set('valoare_lei', e.target.value)}
                style={fieldStyle} placeholder="0" min="0" step="1000" />
            </div>
            <div>
              <label style={labelStyle}>Valoare contract (EUR)</label>
              <input type="number" value={form.valoare_eur} onChange={e => set('valoare_eur', e.target.value)}
                style={fieldStyle} placeholder="0" min="0" step="1000" />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Observații</label>
            <textarea value={form.observatii} onChange={e => set('observatii', e.target.value)}
              style={{ ...fieldStyle, resize: 'vertical', minHeight: 70 }}
              placeholder="Notițe suplimentare despre proiect..." />
          </div>

          {/* Activ toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={form.activ} onChange={e => set('activ', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <span style={{ fontSize: 13, color: G.text, fontWeight: 600 }}>Proiect activ</span>
          </label>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: `1px solid ${G.border}`,
          display: 'flex', gap: 10, justifyContent: 'flex-end', background: G.bg,
        }}>
          <button onClick={onClose} style={{
            padding: '9px 18px', background: G.border, border: 'none',
            borderRadius: 7, color: G.text, fontSize: 13, cursor: 'pointer',
          }}>Anulează</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '9px 18px', background: saving ? G.muted : G.executie, border: 'none',
            borderRadius: 7, color: '#0D1117', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700,
          }}>{saving ? 'Se salvează...' : isNew ? '＋ Crează proiect' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// PLACEHOLDER pentru sub-tab-urile inactive
// ===========================================================================
function PlaceholderTab({ tab }) {
  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{
        background: G.card, border: `1px solid ${G.border}`, borderRadius: 12,
        padding: '60px 40px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.6 }}>{tab.icon}</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: tab.color }}>{tab.label}</div>
        <div style={{ color: G.muted, fontSize: 14, marginBottom: 20, maxWidth: 480, margin: '0 auto 20px' }}>{tab.desc}</div>
        <div style={{
          display: 'inline-block', padding: '8px 16px',
          background: tab.color + '22', border: `1px solid ${tab.color}55`,
          borderRadius: 8, color: tab.color, fontSize: 12, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '.5px',
        }}>
          🚧 În dezvoltare — disponibil într-o fază viitoare
        </div>
      </div>
    </div>
  )
}
