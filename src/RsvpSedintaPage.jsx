// ═══════════════════════════════════════════════════════════════════════════
// RsvpSedintaPage.jsx — pagină PUBLICĂ (fără login), accesată din linkul de
// email trimis la încheierea unei ședințe. Confirmă/refuză participarea prin
// token (fn_sedinte_rsvp_submit, SECURITY DEFINER) — nu necesită cont.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = { bg: '#0D1117', surface: '#161B22', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', green: '#3FB950', red: '#F85149', yellow: '#D29922' }

const TIP_LABEL = { executie: '🏗️ Execuție', logistica: '🚛 Logistică', general: '💬 General' }
const STATUS_LABEL = { acceptat: { txt: 'Participi', color: G.green, icon: '✓' }, refuzat: { txt: 'Nu participi', color: G.red, icon: '✗' }, poate: { txt: 'Poate participi', color: G.yellow, icon: '?' } }
const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

export default function RsvpSedintaPage() {
  const { token, status } = useParams()
  const [rez, setRez] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('fn_sedinte_rsvp_submit', { p_token: token, p_status: status })
      if (error) setRez({ ok: false, error: error.message })
      else setRez(data)
      setLoading(false)
    })()
  }, [token, status])

  const st = rez?.ok ? (STATUS_LABEL[rez.status] || STATUS_LABEL.poate) : null

  return (
    <div style={{ minHeight: '100vh', background: G.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 32, maxWidth: 440, width: '100%', textAlign: 'center' }}>
        {loading ? (
          <div style={{ color: G.muted, fontSize: 14 }}>Se procesează…</div>
        ) : rez?.ok ? (
          <>
            <div style={{ fontSize: 42, marginBottom: 10 }}>{st.icon}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: st.color, marginBottom: 8 }}>{st.txt}</div>
            <div style={{ fontSize: 14, color: G.text, marginBottom: 4 }}>
              {rez.titlu || `Ședință ${TIP_LABEL[rez.tip_sedinta]?.split(' ')[1] || ''}`}
            </div>
            <div style={{ fontSize: 12.5, color: G.muted }}>{fmtData(rez.data)}</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 18 }}>Mulțumim, {rez.nume}! Poți închide pagina.</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 42, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: G.red, marginBottom: 8 }}>Link invalid sau expirat</div>
            <div style={{ fontSize: 12.5, color: G.muted }}>{rez?.error || 'Nu am putut confirma răspunsul.'}</div>
          </>
        )}
      </div>
    </div>
  )
}
