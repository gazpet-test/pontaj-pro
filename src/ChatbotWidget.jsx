// ════════════════════════════════════════════════════════════════════════════
// CHATBOT GAZPET ERP - WIDGET HELP IN-APP (Etapa 9, 16.05.2026)
// ════════════════════════════════════════════════════════════════════════════
// Floating button dreapta-jos → modal cu chat AI
// Răspunde la întrebări gen "Unde apăs să introduc un contract?" / 
// "Unde editez service-ul la un utilaj?"
// 
// Stack: React + Edge Function Supabase /functions/v1/chatbot + Claude Haiku 4.5
// Cost estimat: ~$0.004 per mesaj (~$5-15/lună la trafic normal)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
  purple: '#BC8CFF', orange: '#F0883E',
  primary: '#1F6FEB',
}

// Markdown simplu inline (bold + cod + linie nouă)
function renderInline(text) {
  if (!text) return null
  // Înlocuiesc **bold** cu <strong>
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

// Render mesaj asistent cu suport linie nouă + list numerotată
function renderAssistantMessage(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.trim() === '') return <div key={i} style={{ height: 6 }} />
    return (
      <div key={i} style={{ marginBottom: 3 }}>
        {renderInline(line)}
      </div>
    )
  })
}

export default function ChatbotWidget({ profile }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Salut${profile?.full_name ? ' ' + profile.full_name.split(' ')[0] : ''}! 👋\n\nSunt asistentul Gazpet ERP. Întreabă-mă orice despre app: **"Unde adaug un utilaj?"**, **"Cum editez un service?"**, **"Cum scot un raport ITM?"** etc.`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll la sfârșit când vin mesaje noi
  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollTo({ top: messagesEndRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, loading, open])

  // Focus input când deschid
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  const send = async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    
    const userMsg = { role: 'user', content: trimmed }
    setMessages(p => [...p, userMsg])
    setInput('')
    setLoading(true)
    setError(null)
    
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Nu ești logat. Reîncarcă pagina.')
      }
      
      // Trim history la ultimele 10 mesaje pentru tokens
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
          message: trimmed,
          history: historyForAPI,
          context: { 
            page: window.location.pathname + window.location.search,
            timestamp: new Date().toISOString(),
          },
        }),
      })
      
      const data = await resp.json()
      
      if (!resp.ok) {
        throw new Error(data.error || data.detail || `Eroare ${resp.status}`)
      }
      
      const assistantMsg = { 
        role: 'assistant', 
        content: data.message || 'Răspuns gol primit.',
        usage: data.usage,
      }
      setMessages(p => [...p, assistantMsg])
    } catch (e) {
      console.error('Chatbot error:', e)
      const errMsg = e.message || 'Eroare necunoscută'
      setError(errMsg)
      setMessages(p => [...p, { 
        role: 'assistant', 
        content: `⚠️ Eroare: ${errMsg}\n\nÎncearcă din nou peste câteva secunde. Dacă persistă, contactează administratorul.`,
        isError: true,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }
  
  const clearChat = () => {
    if (!confirm('Începi o conversație nouă? Istoricul curent se va pierde.')) return
    setMessages([
      {
        role: 'assistant',
        content: `Salut din nou! 👋 Cu ce te ajut?`,
      },
    ])
    setError(null)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Sugestii rapide când e gol
  const quickPrompts = [
    'Unde adaug un utilaj nou?',
    'Cum editez o fișă de service?',
    'Unde văd scadențele de revizie?',
    'Cum import EvoGPS?',
  ]

  return (
    <>
      {/* FLOATING BUTTON */}
      <button
        onClick={() => setOpen(!open)}
        title={open ? 'Închide chat' : 'Asistent AI Gazpet ERP'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: open ? G.red : `linear-gradient(135deg, ${G.primary}, ${G.purple})`,
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,.4), 0 2px 6px rgba(31,111,235,.3)',
          cursor: 'pointer',
          fontSize: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9998,
          transition: 'all .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {open ? '×' : '💬'}
      </button>

      {/* CHAT PANEL */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 96,
          right: 24,
          width: 'min(420px, calc(100vw - 32px))',
          height: 'min(640px, calc(100vh - 140px))',
          background: G.surface,
          border: `1px solid ${G.border2}`,
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.6), 0 4px 20px rgba(0,0,0,.3)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 9997,
          overflow: 'hidden',
        }}>
          {/* HEADER */}
          <div style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${G.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: `linear-gradient(135deg, ${G.primary}11, ${G.purple}11)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${G.primary}, ${G.purple})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}>🤖</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: G.text }}>Asistent Gazpet</div>
                <div style={{ fontSize: 10, color: G.muted, marginTop: 1 }}>
                  Powered by Claude · răspunde la întrebări despre app
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button 
                onClick={clearChat}
                title="Conversație nouă"
                style={{
                  background: 'transparent',
                  border: `1px solid ${G.border}`,
                  color: G.muted,
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 12,
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
                  fontSize: 22,
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: 0,
                  width: 28,
                }}>
                ×
              </button>
            </div>
          </div>

          {/* MESSAGES */}
          <div 
            ref={messagesEndRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 8,
              }}>
                {/* Avatar */}
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: m.role === 'user' ? G.primary : (m.isError ? G.red : `linear-gradient(135deg, ${G.primary}, ${G.purple})`),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#fff',
                  flexShrink: 0,
                }}>
                  {m.role === 'user' ? (profile?.full_name?.[0]?.toUpperCase() || 'U') : (m.isError ? '!' : '🤖')}
                </div>
                {/* Bubble */}
                <div style={{
                  maxWidth: 'calc(100% - 44px)',
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: m.role === 'user' ? G.primary + '22' : G.bg,
                  color: G.text,
                  border: `1px solid ${m.role === 'user' ? G.primary + '44' : (m.isError ? G.red + '44' : G.border)}`,
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {m.role === 'user' ? m.content : renderAssistantMessage(m.content)}
                </div>
              </div>
            ))}
            
            {/* Loading indicator */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: `linear-gradient(135deg, ${G.primary}, ${G.purple})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  flexShrink: 0,
                }}>🤖</div>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: G.bg,
                  border: `1px solid ${G.border}`,
                  display: 'flex',
                  gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out infinite both' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out 0.2s infinite both' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: G.muted, animation: 'cb-pulse 1.4s ease-in-out 0.4s infinite both' }} />
                </div>
                <style>{`@keyframes cb-pulse { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }`}</style>
              </div>
            )}

            {/* Quick prompts (când doar mesajul de bun venit) */}
            {messages.length === 1 && !loading && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: G.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>💡 Sugestii rapide:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {quickPrompts.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(p); setTimeout(send, 100) }}
                      style={{
                        background: G.bg,
                        border: `1px solid ${G.border}`,
                        color: G.text,
                        textAlign: 'left',
                        padding: '7px 11px',
                        borderRadius: 8,
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all .15s',
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

          {/* INPUT */}
          <div style={{
            padding: '10px 12px',
            borderTop: `1px solid ${G.border}`,
            background: G.bg,
          }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Scrie întrebarea ta... (Enter pentru trimite, Shift+Enter pentru linie nouă)"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1,
                  background: G.surface,
                  border: `1px solid ${G.border2}`,
                  color: G.text,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'none',
                  minHeight: 36,
                  maxHeight: 100,
                  outline: 'none',
                  opacity: loading ? 0.6 : 1,
                }}
                onFocus={e => { e.target.style.borderColor = G.primary }}
                onBlur={e => { e.target.style.borderColor = G.border2 }}
              />
              <button
                onClick={send}
                disabled={loading || !input.trim()}
                style={{
                  background: (loading || !input.trim()) ? G.border2 : G.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: (loading || !input.trim()) ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all .15s',
                }}>
                {loading ? '⏳' : '➤'}
              </button>
            </div>
            <div style={{ fontSize: 9, color: G.dim, marginTop: 5, textAlign: 'center' }}>
              AI poate face greșeli. Verifică info importantă.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
