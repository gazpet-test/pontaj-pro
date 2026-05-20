// ===========================================================================
// MODUL EXECUȚIE — Shell cu sub-tab navigation
// ===========================================================================
// 20.05.2026 — FAZA 1:
//   • Sub-tab „📐 Izometrie" ACTIV — pachete lansare țeavă, tronsoane, cumulat
//   • Sub-tab „🏗️ Șantiere" placeholder (Faza 2)
//   • Sub-tab „📋 Devize" placeholder (Faza 3)
//   • Sub-tab „☁️ Vreme live" placeholder (Faza 4)
// URL deep-link: /executie?tab=izometrie
// ===========================================================================

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import IzometriePage from './Izometrie.jsx'

// Theme G consistent cu restul modulelor
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', purple:'#A371F7',
  executie:'#58A6FF', // accent modul Execuție
}

// ===========================================================================
// SUB-TAB DEFINITIONS
// ===========================================================================

const SUB_TABS = [
  { key: 'izometrie', label: 'Izometrie',  icon: '📐',  color: G.purple, active: true,  desc: 'Pachete lansare · Tronsoane · Cumulat final' },
  { key: 'santiere',  label: 'Șantiere',   icon: '🏗️', color: G.blue,   active: false, desc: 'Echipe pe șantier · Progres · Materiale' },
  { key: 'devize',    label: 'Devize',     icon: '📋',  color: G.green,  active: false, desc: 'Devize ofertă · Antemăsurători · Estimări' },
  { key: 'vreme',     label: 'Vreme live', icon: '☁️',  color: G.yellow, active: false, desc: 'Prognoză 7 zile · Alerte meteo per șantier' },
]

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

export default function ExecutiePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initTab = searchParams.get('tab') || 'izometrie'
  const [tab, setTab] = useState(initTab)

  // Sync URL la schimbare tab
  useEffect(() => {
    const current = searchParams.get('tab')
    if (current !== tab) {
      setSearchParams({ tab }, { replace: true })
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync tab la schimbare URL (back button browser)
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && urlTab !== tab) setTab(urlTab)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = SUB_TABS.find(t => t.key === tab) || SUB_TABS[0]
  const isPlaceholder = !activeTab.active

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>
      {/* ─────────── SUB-TAB NAVIGATION (sticky sub navbar global) ─────────── */}
      <div style={{
        position: 'sticky',
        top: 60,
        zIndex: 50,
        background: G.surface,
        borderBottom: `1px solid ${G.border}`,
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
              borderRadius: 8, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 16,
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
                  padding: '14px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${isActive ? t.color : 'transparent'}`,
                  color: disabled ? G.dim : isActive ? t.color : G.text,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  transition: 'all .15s ease',
                  display: 'flex', alignItems: 'center', gap: 7,
                  opacity: disabled ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  if (!disabled && !isActive) e.currentTarget.style.color = t.color
                }}
                onMouseLeave={e => {
                  if (!disabled && !isActive) e.currentTarget.style.color = G.text
                }}
              >
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                {t.label}
                {disabled && (
                  <span style={{
                    fontSize: 9, padding: '2px 5px',
                    background: G.border2, color: G.muted,
                    borderRadius: 4, marginLeft: 4, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '.3px',
                  }}>
                    soon
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ─────────── SUB-TAB CONTENT ─────────── */}
      {isPlaceholder ? (
        <PlaceholderTab tab={activeTab} />
      ) : (
        <>
          {tab === 'izometrie' && <IzometriePage />}
        </>
      )}
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
        background: G.card,
        border: `1px solid ${G.border}`,
        borderRadius: 12,
        padding: '60px 40px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.6 }}>{tab.icon}</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: tab.color }}>
          {tab.label}
        </div>
        <div style={{ color: G.muted, fontSize: 14, marginBottom: 20, maxWidth: 480, margin: '0 auto 20px' }}>
          {tab.desc}
        </div>
        <div style={{
          display: 'inline-block',
          padding: '8px 16px',
          background: tab.color + '22',
          border: `1px solid ${tab.color}55`,
          borderRadius: 8,
          color: tab.color,
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '.5px',
        }}>
          🚧 În dezvoltare — disponibil într-o fază viitoare
        </div>
      </div>
    </div>
  )
}
