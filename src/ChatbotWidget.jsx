// ════════════════════════════════════════════════════════════════════════════
// CHATBOT GAZPET ERP v4 - WIDGET „NENICU" (Etapa 11, 18.05.2026)
// ════════════════════════════════════════════════════════════════════════════
// v4 schimbări:
//   - Rebrand „Inginerul Gazpet" → „Nenicu" (mai cald, mai casual)
//   - Mascotă PĂSTRATĂ (cască + carte = nenicu' care le știe toate)
//   - Greeting nou: „Eu sunt Nenicul tău — te ajut cu app-ul"
// v3 (anterior):
//   - Mascotă custom „Inginerul" (SVG inline: cască galbenă + carte + zâmbet)
//   - Font 2.5x mai mare peste tot (13 → 19-20px)
//   - Rate limit progresiv 20/10/5 cu badge vizibil + warning
//   - Mesaje 429 (rate limit atins) afișate special
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
  purple: '#BC8CFF', orange: '#F0883E',
  primary: '#1F6FEB',
  helmet: '#F5C518',
  book: '#E66B3C',
  skin: '#F4C99A',
}

// ════════ MASCOTA NENICU — SVG inline (cască + carte, intact din v3) ════════
function InginerAvatar({ size = 'md', happy = true }) {
  const px = size === 'sm' ? 32 : size === 'lg' ? 60 : 44
  return (
    <svg width={px} height={px} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={G.primary} />
          <stop offset="100%" stopColor={G.purple} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#bgGrad)" />
      
      <ellipse cx="50" cy="48" rx="22" ry="24" fill={G.skin} stroke="#8B5A2B" strokeWidth="0.8" />
      <path d="M 30 38 Q 28 50 32 58" stroke="#3D2817" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M 70 38 Q 72 50 68 58" stroke="#3D2817" strokeWidth="2" fill="none" strokeLinecap="round" />
      
      <path d="M 25 36 Q 26 22 50 20 Q 74 22 75 36 L 78 38 L 22 38 Z" fill={G.helmet} stroke="#8B6F00" strokeWidth="1.2" />
      <path d="M 49 21 L 51 21 L 51 35 L 49 35 Z" fill="#C99A00" />
      <ellipse cx="50" cy="37" rx="28" ry="2.5" fill="#D4A600" />
      
      <circle cx="42" cy="50" r="5" fill="none" stroke="#1A1A1A" strokeWidth="1.5" />
      <circle cx="58" cy="50" r="5" fill="none" stroke="#1A1A1A" strokeWidth="1.5" />
      <path d="M 47 50 L 53 50" stroke="#1A1A1A" strokeWidth="1.5" />
      <circle cx="40" cy="48" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="56" cy="48" r="1.5" fill="#fff" opacity="0.6" />
      <circle cx="42" cy="50.5" r="1.2" fill="#1A1A1A" />
      <circle cx="58" cy="50.5" r="1.2" fill="#1A1A1A" />
      
      <path d="M 50 53 L 49 58 L 51 58 Z" fill="#D4A37D" />
      
      {happy ? (
        <path d="M 43 63 Q 50 68 57 63" stroke="#8B3A1A" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M 44 65 L 56 65" stroke="#8B3A1A" strokeWidth="1.8" strokeLinecap="round" />
      )}
      
      <g transform="translate(63, 70) rotate(-15)">
        <rect x="0" y="0" width="22" height="16" rx="1" fill={G.book} stroke="#7A2E10" strokeWidth="0.8" />
        <rect x="2" y="2" width="9" height="12" fill="#FFF8DC" stroke="#8B6F47" strokeWidth="0.4" />
        <rect x="11" y="2" width="9" height="12" fill="#FFF8DC" stroke="#8B6F47" strokeWidth="0.4" />
        <line x1="3.5" y1="5" x2="9.5" y2="5" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="3.5" y1="7" x2="9.5" y2="7" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="3.5" y1="9" x2="9.5" y2="9" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="12.5" y1="5" x2="18.5" y2="5" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="12.5" y1="7" x2="18.5" y2="7" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="12.5" y1="9" x2="18.5" y2="9" stroke="#7A6F4F" strokeWidth="0.4" />
        <line x1="11" y1="0" x2="11" y2="16" stroke="#5A1F08" strokeWidth="0.8" />
      </g>
      
      <path d="M 30 76 Q 50 70 70 76 L 70 95 L 30 95 Z" fill={G.primary} stroke="#0D4FB8" strokeWidth="0.5" />
      <path d="M 47 76 L 50 84 L 53 76 L 51 86 L 49 86 Z" fill={G.red} />
    </svg>
  )
}

function renderInline(text) {
  if (!text) return null
  const parts = []
  let lastIdx = 0
  const regex = /\*\*([^*]+)\*\*/g
  let m
  let key = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index))
    parts.push(<strong key={key++} style={{ color: G.text, fontWeight: 700 }}>{m[1]}</strong>)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return parts
}

function renderAssistantMessage(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.trim() === '') return <div key={i} style={{ height: 8 }} />
    return (
      <div key={i} style={{ marginBottom: 5 }}>
        {renderInline(line)}
      </div>
    )
  })
}

function TierBadge({ tier, remaining, limit }) {
  if (!tier) return null
  if (tier === 'owner_unlimited') {
    return (
      <span style={{
        fontSize: 11, padding: '3px 9px', borderRadius: 10,
        background: G.purple + '22', color: G.purple, fontWeight: 700,
        border: `1px solid ${G.purple}44`,
      }}>♾️ Unlimited</span>
    )
  }
  const isLow = remaining <= 2
  const color = isLow ? G.red : (remaining <= 5 ? G.yellow : G.green)
  return (
    <span style={{
      fontSize: 11, padding: '3px 9px', borderRadius: 10,
      background: color + '22', color: color, fontWeight: 700,
      border: `1px solid ${color}44`,
    }}>
      {remaining}/{limit} azi
    </span>
  )
}

export default function ChatbotWidget({ profile }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() => {
    const numePrenume = profile?.name ? profile.name.split(' ').slice(-1)[0] : ''
    return [{
      role: 'assistant',
      content: `Salut${numePrenume ? ' ' + numePrenume : ''}! 👋\n\nEu sunt **Nenicul tău** — te ajut cu app-ul. Întreabă-mă orice:\n\n• **"Unde adaug un utilaj?"**\n• **"Cum editez un service?"**\n• **"Câte tichete urgente am acum?"**`,
    }]
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [rateLimit, setRateLimit] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollTo({ top: messagesEndRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, loading, open])

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const send = async (overrideText) => {
    const text = (overrideText !== undefined ? overrideText : input).trim()
    if (!text || loading) return
    
    const userMsg = { role: 'user', content: text }
    setMessages(p => [...p, userMsg])
    setInput('')
    setLoading(true)
    
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Nu ești logat. Reîncarcă pagina.')
      
      const historyForAPI = messages.slice(-10).filter(m => m.role !== 'system')
      
      const url = `${supabase.supabaseUrl}/functions/v1/chatbot`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          'apikey': supabase.supabaseKey || '',
        },
        body: JSON.stringify({
          message: text,
          history: historyForAPI,
          context: { 
            page: window.location.pathname + window.location.search,
            timestamp: new Date().toISOString(),
          },
        }),
      })
      
      const data = await resp.json()
      
      if (resp.status === 429) {
        setRateLimit({ limit: data.limit, remaining: 0, tier: data.tier })
        setMessages(p => [...p, { 
          role: 'assistant', 
          content: `⏸️ ${data.message || 'Ai atins limita zilnică.'}\n\nLimite Gazpet:\n• Primele 100 întrebări: **20/zi**\n• După 100: **10/zi**\n• După 1000: **5/zi**\n\nLimita se resetează la miezul nopții. 🌙`,
          isRateLimit: true,
        }])
        return
      }
      
      if (!resp.ok) {
        throw new Error(data.error || data.detail || `Eroare ${resp.status}`)
      }
      
      if (data.rate_limit) setRateLimit(data.rate_limit)
      
      setMessages(p => [...p, { 
        role: 'assistant', 
        content: data.message || 'Răspuns gol primit.',
      }])
    } catch (e) {
      console.error('Chatbot error:', e)
      const errMsg = e.message || 'Eroare necunoscută'
      setMessages(p => [...p, { 
        role: 'assistant', 
        content: `⚠️ ${errMsg}\n\nÎncearcă din nou peste câteva secunde.`,
        isError: true,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }
  
  const clearChat = () => {
    if (!confirm('Conversație nouă? Istoricul curent se pierde.')) return
    const numePrenume = profile?.name ? profile.name.split(' ').slice(-1)[0] : ''
    setMessages([{
      role: 'assistant',
      content: `Salut din nou${numePrenume ? ' ' + numePrenume : ''}! 👋 Cu ce te ajut?`,
    }])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const quickPrompts = [
    'Unde adaug un utilaj nou?',
    'Cum editez o fișă de service?',
    'Unde văd scadențele de revizie?',
    'Cum import EvoGPS?',
  ]

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title={open ? 'Închide chat' : 'Nenicu — Asistent AI'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 70,
          height: 70,
          borderRadius: '50%',
          background: open ? G.red : 'transparent',
          color: '#fff',
          border: open ? 'none' : `3px solid ${G.primary}`,
          boxShadow: '0 6px 24px rgba(0,0,0,.45), 0 2px 8px rgba(31,111,235,.35)',
          cursor: 'pointer',
          fontSize: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9998,
          transition: 'all .2s',
          padding: 0,
          overflow: 'hidden',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {open ? '×' : <InginerAvatar size="lg" />}
      </button>

      {open && (
        <div style={{
          position: 'fixed',
          bottom: 104,
          right: 24,
          width: 'min(520px, calc(100vw - 32px))',
          height: 'min(760px, calc(100vh - 140px))',
          background: G.surface,
          border: `1px solid ${G.border2}`,
          borderRadius: 16,
          boxShadow: '0 24px 70px rgba(0,0,0,.65), 0 6px 24px rgba(0,0,0,.35)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 9997,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${G.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: `linear-gradient(135deg, ${G.primary}15, ${G.purple}15)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <InginerAvatar size="md" />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>Nenicu</div>
                <div style={{ fontSize: 14, color: G.muted, marginTop: 2 }}>
                  Nenicul tău AI · răspunde la tot
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {rateLimit && <TierBadge {...rateLimit} />}
              <button 
                onClick={clearChat}
                title="Conversație nouă"
                style={{
                  background: 'transparent',
                  border: `1px solid ${G.border}`,
                  color: G.muted,
                  borderRadius: 6,
                  padding: '6px 11px',
                  fontSize: 17,
                  cursor: 'pointer',
                }}>
                🔄
              </button>
              <button
                onClick={() => setOpen(false)}
                title="Închide"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: G.muted,
                  fontSize: 30,
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: 0,
                  width: 36,
                }}>
                ×
              </button>
            </div>
          </div>

          <div 
            ref={messagesEndRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 10,
              }}>
                {m.role === 'user' ? (
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: G.primary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    fontWeight: 800,
                    color: '#fff',
                    flexShrink: 0,
                  }}>
                    {profile?.name?.[0]?.toUpperCase() || 'U'}
                  </div>
                ) : (
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: m.isError ? G.red : (m.isRateLimit ? G.yellow + '33' : 'transparent'),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}>
                    {m.isError ? (
                      <span style={{ fontSize: 18, color: '#fff', fontWeight: 800 }}>!</span>
                    ) : m.isRateLimit ? (
                      <span style={{ fontSize: 18 }}>⏸️</span>
                    ) : (
                      <InginerAvatar size="sm" happy={!m.isError} />
                    )}
                  </div>
                )}
                <div style={{
                  maxWidth: 'calc(100% - 50px)',
                  padding: '12px 16px',
                  borderRadius: 14,
                  background: m.role === 'user' ? G.primary + '22' : (m.isRateLimit ? G.yellow + '15' : G.bg),
                  color: G.text,
                  border: `1px solid ${
                    m.role === 'user' ? G.primary + '44' : 
                    (m.isError ? G.red + '44' : (m.isRateLimit ? G.yellow + '55' : G.border))
                  }`,
                  fontSize: 20,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {m.role === 'user' ? m.content : renderAssistantMessage(m.content)}
                </div>
              </div>
            ))}
            
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden' }}>
                  <InginerAvatar size="sm" />
                </div>
                <div style={{
                  padding: '14px 18px',
                  borderRadius: 14,
                  background: G.bg,
                  border: `1px solid ${G.border}`,
                  display: 'flex',
                  gap: 7,
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out infinite both' }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out 0.2s infinite both' }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out 0.4s infinite both' }} />
                </div>
                <style>{`@keyframes cb-pulse { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }`}</style>
              </div>
            )}

            {messages.length === 1 && !loading && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 14, color: G.muted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700 }}>
                  💡 Sugestii rapide:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {quickPrompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => send(p)}
                      style={{
                        background: G.bg,
                        border: `1px solid ${G.border}`,
                        color: G.text,
                        textAlign: 'left',
                        padding: '13px 16px',
                        borderRadius: 10,
                        fontSize: 17,
                        cursor: 'pointer',
                        transition: 'all .15s',
                        fontWeight: 500,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = G.primary + '22'; e.currentTarget.style.borderColor = G.primary + '55' }}
                      onMouseLeave={e => { e.currentTarget.style.background = G.bg; e.currentTarget.style.borderColor = G.border }}
                    >
                      💭 {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{
            padding: '12px 14px',
            borderTop: `1px solid ${G.border}`,
            background: G.bg,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Scrie întrebarea ta..."
                rows={1}
                disabled={loading}
                style={{
                  flex: 1,
                  background: G.surface,
                  border: `1px solid ${G.border2}`,
                  color: G.text,
                  borderRadius: 10,
                  padding: '13px 16px',
                  fontSize: 19,
                  fontFamily: 'inherit',
                  resize: 'none',
                  minHeight: 52,
                  maxHeight: 120,
                  outline: 'none',
                  opacity: loading ? 0.6 : 1,
                  lineHeight: 1.45,
                }}
                onFocus={e => { e.target.style.borderColor = G.primary }}
                onBlur={e => { e.target.style.borderColor = G.border2 }}
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                style={{
                  background: (loading || !input.trim()) ? G.border2 : G.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '13px 20px',
                  fontSize: 20,
                  fontWeight: 800,
                  cursor: (loading || !input.trim()) ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all .15s',
                  minHeight: 52,
                }}>
                {loading ? '⏳' : '➤'}
              </button>
            </div>
            <div style={{ fontSize: 13, color: G.dim, marginTop: 8, textAlign: 'center' }}>
              Enter = trimite · Shift+Enter = linie nouă · AI poate face greșeli
            </div>
          </div>
        </div>
      )}
    </>
  )
}
