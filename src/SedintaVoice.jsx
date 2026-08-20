// ═══════════════════════════════════════════════════════════════════════════
// SedintaVoice.jsx — audio în timpul ședinței (Razvan 20.08.2026)
// Ședințele de la distanță se aud direct în platformă: cameră audio per
// ședință prin 8x8 JaaS (Jitsi), fără alt cont — identitatea vine din
// PontajPRO. Tokenul se semnează server-side (edge fn sedinta-voice-token),
// nicio cheie nu ajunge în frontend. Video e pregătit dar pornește oprit.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  green: '#3FB950', red: '#F85149', yellow: '#D29922', cyan: '#56D4DD',
}

// scriptul extern (external_api.js) se încarcă o singură dată per pagină
let scriptPromise = null
const incarcaScript = (appId) => {
  if (window.JitsiMeetExternalAPI) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((res, rej) => {
      const s = document.createElement('script')
      s.src = `https://8x8.vc/${appId}/external_api.js`
      s.async = true
      s.onload = res
      s.onerror = () => { scriptPromise = null; rej(new Error('Nu s-a putut încărca scriptul 8x8 — verifică conexiunea')) }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export default function SedintaVoice({ sedintaId, onClose }) {
  const [stare, setStare] = useState('conectare')   // conectare | activ | eroare | neconfigurat
  const [eroare, setEroare] = useState('')
  const [participanti, setParticipanti] = useState(0)
  const containerRef = useRef(null)
  const apiRef = useRef(null)

  useEffect(() => {
    let anulat = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Nu ești autentificat')
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sedinta-voice-token`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sedinta_id: sedintaId }),
        })
        const r = await resp.json()
        if (anulat) return
        if (r?.error === 'JAAS_NECONFIGURAT') { setStare('neconfigurat'); return }
        if (!r?.ok) throw new Error(r?.error || 'Nu am primit token de acces')

        await incarcaScript(r.app_id)
        if (anulat || !containerRef.current) return

        const api = new window.JitsiMeetExternalAPI('8x8.vc', {
          roomName: `${r.app_id}/${r.room}`,
          jwt: r.token,
          parentNode: containerRef.current,
          width: '100%', height: '100%',
          lang: 'ro',
          configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: true,           // video pregătit, dar pornește oprit
            disableDeepLinking: true,            // pe telefon rămâne în browser, nu cere aplicația
            prejoinConfig: { enabled: false },   // numele vine din platformă — intră direct
            defaultLanguage: 'ro',
            toolbarButtons: ['microphone', 'camera', 'desktop', 'tileview', 'settings', 'fullscreen', 'hangup'],
            notifications: [],
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
          },
          userInfo: { displayName: r.nume },
        })
        apiRef.current = api
        api.addListener('videoConferenceJoined', () => { if (!anulat) setStare('activ') })
        api.addListener('participantJoined', () => { if (!anulat) setParticipanti(api.getNumberOfParticipants()) })
        api.addListener('participantLeft', () => { if (!anulat) setParticipanti(api.getNumberOfParticipants()) })
        api.addListener('videoConferenceLeft', () => { if (!anulat) onClose?.() })
        api.addListener('readyToClose', () => { if (!anulat) onClose?.() })
      } catch (e) {
        if (!anulat) { setStare('eroare'); setEroare(e.message || String(e)) }
      }
    })()
    return () => {
      anulat = true
      try { apiRef.current?.dispose() } catch { /* iframe-ul poate fi deja demontat */ }
      apiRef.current = null
    }
  }, [sedintaId, onClose])

  if (stare === 'neconfigurat') return (
    <div style={{ background: G.surface, border: `1px solid ${G.yellow}55`, borderRadius: 12, padding: 18, marginBottom: 14, fontSize: 13, color: G.yellow }}>
      🎧 Audio-ul nu e activat încă — lipsesc cheile 8x8 JaaS. Razvan trebuie să configureze contul (2 minute), apoi butonul merge pentru toată lumea.
    </div>
  )
  if (stare === 'eroare') return (
    <div style={{ background: G.surface, border: `1px solid ${G.red}55`, borderRadius: 12, padding: 18, marginBottom: 14, fontSize: 13, color: G.red }}>
      Nu m-am putut conecta la audio: {eroare}
      <button onClick={onClose} style={{ marginLeft: 12, background: 'transparent', border: `1px solid ${G.border2}`, color: G.muted, borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Închide</button>
    </div>
  )
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.cyan}44`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', borderBottom: `1px solid ${G.border2}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: G.cyan }}>
          🎧 {stare === 'conectare' ? 'Se conectează…' : 'Ședință audio în desfășurare'}
        </span>
        {stare === 'activ' && (
          <span style={{ fontSize: 11.5, color: G.muted }}>
            {participanti} {participanti === 1 ? 'participant' : 'participanți'} · microfonul se închide din bara de jos
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={onClose} title="Ieși din audio"
          style={{ background: G.red + '18', border: `1px solid ${G.red}44`, color: G.red, borderRadius: 8, padding: '4px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          Părăsește
        </button>
      </div>
      {/* iframe-ul Jitsi se montează singur în containerRef — divul rămâne gol
          pentru React, altfel reconcilierea se bate cu DOM-ul extern */}
      <div style={{ position: 'relative', height: 'min(58vh, 480px)', background: G.bg }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {stare === 'conectare' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: G.dim, fontSize: 13, pointerEvents: 'none' }}>
            ⏳ Se pregătește camera audio…
          </div>
        )}
      </div>
    </div>
  )
}
