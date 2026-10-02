// ════════════════════════════════════════════════════════════════
// ctcUi.jsx — elemente de UI comune pentru modulul CTC (paletă, toast, modal, butoane)
// Stil: inline styles pe obiecte JS, ca în restul ERP-ului.
// ════════════════════════════════════════════════════════════════
import { useState, useCallback } from 'react'

export const G = {
  bg: '#0D1117', surface: '#161B22', card2: '#1C2128', border: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  ctc: '#BC8CFF', green: '#3FB950', blue: '#58A6FF', orange: '#F0883E', red: '#F85149', yellow: '#E3B341',
}

export const inputSt = {
  background: G.bg, border: `1px solid ${G.border}`, color: G.text, borderRadius: 8, padding: '8px 11px',
  fontFamily: 'inherit', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
}

export const btn = (color = G.ctc, solid = false) => ({
  padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  background: solid ? color : color + '22', color: solid ? '#0D1117' : color, border: `1px solid ${solid ? color : color + '55'}`,
  whiteSpace: 'nowrap',
})
export const btnMic = (color = G.ctc) => ({
  padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  background: color + '22', color, border: `1px solid ${color}44`, whiteSpace: 'nowrap',
})

export function useToast() {
  const [toast, setToast] = useState(null)
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4500)
  }, [])
  const ToastEl = toast ? (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999, maxWidth: 440,
      background: toast.type === 'error' ? G.red : toast.type === 'warn' ? G.yellow : G.green, color: '#0D1117',
      padding: '12px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    }}>{toast.msg}</div>
  ) : null
  return { showToast, ToastEl }
}

export function Modal({ titlu, onClose, children, latime = 560 }) {
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, width: '100%', maxWidth: latime }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${G.border}` }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{titlu}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: G.muted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

// div, NU label: un <label> cu mai multe butoane în el redirecționează click-ul către primul control
// (ex. ✕ de pe un chip tocmai adăugat) și îl anulează.
export const Camp = ({ label, children, hint }) => (
  <div style={{ display: 'block', marginBottom: 12 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: G.muted, marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 11, color: G.dim, marginTop: 3 }}>{hint}</div>}
  </div>
)

export const STATUS_DOC_UI = {
  lipsa:     { emoji: '⬜', label: 'Lipsă',     color: G.muted },
  incarcat:  { emoji: '📥', label: 'Încărcat',  color: G.blue },
  verificat: { emoji: '✅', label: 'Verificat', color: G.green },
  na:        { emoji: '➖', label: 'N/A',       color: G.dim },
}
export const STATUS_CARTE_UI = {
  in_lucru: { label: 'În lucru', color: G.yellow },
  completa: { label: 'Completă', color: G.blue },
  predata:  { label: 'Predată',  color: G.green },
}

export const fmtData = (v) => (v ? new Date(v).toLocaleDateString('ro-RO') : '—')
export const fmtMb = (b) => (!b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB')

export function BaraProgres({ valoare, total, color = G.green, h = 8 }) {
  const pct = total > 0 ? Math.min(100, Math.round((valoare / total) * 100)) : 0
  return (
    <div style={{ background: G.border, borderRadius: h, height: h, overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', background: color }} />
    </div>
  )
}
