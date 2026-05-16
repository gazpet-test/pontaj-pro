// ════════════════════════════════════════════════════════════════════════════
// CHAT INTERN GAZPET ERP (Etapa 9.5, 16.05.2026) - PARTEA 1 MVP
// ════════════════════════════════════════════════════════════════════════════
// Features:
//   - Buton 💬 fixed top-right cu badge unread
//   - Panel lateral dreapta sub navbar
//   - Sidebar chats (Lobby Gazpet + future custom chats)
//   - Realtime via Supabase Realtime postgres_changes
//   - Browser Notification API când panel închis
//   - Mark as read automat la deschiderea chatului
//   - Compose cu Enter (Shift+Enter = newline)
// 
// TODO Partea 2: Modal Admin Settings (invite/exclude/promovează membri)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
  purple: '#BC8CFF', orange: '#F0883E',
  primary: '#1F6FEB',
}

// Helpers
function formatTime(d) {
  if (!d) return ''
  const date = new Date(d)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  if (date.toDateString() === yest.toDateString()) return 'ieri ' + date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFromId(id) {
  if (!id) return G.muted
  // Hash deterministic pe UUID/email pentru culoare avatar
  let hash = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash = hash & hash
  }
  const colors = [G.primary, G.purple, G.orange, G.green, '#EC6CB9', '#3FB6E2', '#A371F7', G.yellow]
  return colors[Math.abs(hash) % colors.length]
}

function Avatar({ name, userId, size = 36 }) {
  const bg = colorFromId(userId)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: Math.max(11, Math.round(size * 0.4)), fontWeight: 800,
      flexShrink: 0,
    }}>{getInitials(name)}</div>
  )
}

export default function InternalChat({ profile }) {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [totalUnread, setTotalUnread] = useState(0)
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const realtimeChannelRef = useRef(null)
  const lastNotifiedMsgIdRef = useRef(null)

  const currentUserId = profile?.id

  // ─── Load chats list ────────────────────────────────────────────────
  const loadChats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('v_chat_list')
        .select('*')
      if (error) throw error
      setChats(data || [])
      // Total unread
      const total = (data || []).reduce((acc, c) => acc + (c.muted ? 0 : (c.unread_count || 0)), 0)
      setTotalUnread(total)
      // Selectează primul chat automat dacă nu e selectat
      if (!activeChatId && data && data.length > 0) {
        setActiveChatId(data[0].id)
      }
    } catch (e) {
      console.error('loadChats error:', e)
    }
  }, [activeChatId])

  // ─── Load messages for active chat ──────────────────────────────────
  const loadMessages = useCallback(async (chatId) => {
    if (!chatId) return
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, chat_id, sender_id, content, created_at, edited_at, deleted')
        .eq('chat_id', chatId)
        .eq('deleted', false)
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      setMessages(data || [])
    } catch (e) {
      console.error('loadMessages error:', e)
    }
  }, [])

  // ─── Load members + their profile names ─────────────────────────────
  const loadMembers = useCallback(async (chatId) => {
    if (!chatId) return
    try {
      const { data: memberData, error } = await supabase
        .from('chat_members')
        .select('user_id, member_role')
        .eq('chat_id', chatId)
      if (error) throw error
      
      // Fetch profile names pentru fiecare user_id
      const userIds = (memberData || []).map(m => m.user_id)
      if (userIds.length === 0) {
        setMembers([])
        return
      }
      
      const { data: profileData, error: profErr } = await supabase
        .from('profiles')
        .select('id, name, role, email')
        .in('id', userIds)
      if (profErr) throw profErr
      
      const profMap = new Map((profileData || []).map(p => [p.id, p]))
      const merged = (memberData || []).map(m => ({
        user_id: m.user_id,
        member_role: m.member_role,
        name: profMap.get(m.user_id)?.name || profMap.get(m.user_id)?.email?.split('@')[0] || 'Necunoscut',
        role: profMap.get(m.user_id)?.role,
      }))
      setMembers(merged)
    } catch (e) {
      console.error('loadMembers error:', e)
    }
  }, [])

  // ─── Mark chat as read ──────────────────────────────────────────────
  const markAsRead = useCallback(async (chatId) => {
    if (!chatId) return
    try {
      await supabase.rpc('fn_chat_mark_read', { p_chat_id: chatId })
      // Refresh chats list pentru a actualiza unread
      loadChats()
    } catch (e) {
      console.error('markAsRead error:', e)
    }
  }, [loadChats])

  // ─── Send message ───────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !activeChatId || sending) return
    setSending(true)
    try {
      const { error } = await supabase
        .from('chat_messages')
        .insert({
          chat_id: activeChatId,
          sender_id: currentUserId,
          content: text,
        })
      if (error) throw error
      setInput('')
      // Realtime va aduce mesajul, dar pentru responsivitate îl adăugăm optimistic
      // Actually mai bine las realtime să-l aducă pentru consistency
    } catch (e) {
      console.error('sendMessage error:', e)
      alert('Eroare la trimitere: ' + e.message)
    } finally {
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // ─── Browser Notification ───────────────────────────────────────────
  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      console.warn('Browser nu suportă notificări')
      return
    }
    if (Notification.permission === 'granted') {
      setNotifyEnabled(true)
      return
    }
    if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission()
      setNotifyEnabled(perm === 'granted')
    }
  }

  const showBrowserNotification = useCallback((title, body) => {
    if (!notifyEnabled || document.hasFocus()) return
    try {
      const notif = new Notification(title, {
        body: body.substring(0, 200),
        icon: '/favicon.ico',
        tag: 'gazpet-chat',
        silent: false,
      })
      notif.onclick = () => {
        window.focus()
        setOpen(true)
        notif.close()
      }
      setTimeout(() => notif.close(), 8000)
    } catch (e) {
      console.warn('Notification error:', e)
    }
  }, [notifyEnabled])

  // ─── Initial load + notification permission check ──────────────────
  useEffect(() => {
    if (!currentUserId) return
    loadChats()
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotifyEnabled(true)
    }
  }, [currentUserId, loadChats])

  // ─── Auto-load messages + members + mark read when activeChat changes
  useEffect(() => {
    if (activeChatId && open) {
      loadMessages(activeChatId)
      loadMembers(activeChatId)
      markAsRead(activeChatId)
    }
  }, [activeChatId, open, loadMessages, loadMembers, markAsRead])

  // ─── Realtime subscription ──────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return

    // Cleanup previous channel
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }

    // Subscribe to ALL chat_messages where user is member
    // Filtru per chat_id specific e mai eficient, dar pentru MVP luăm toate și filtrăm client-side
    const channel = supabase
      .channel('chat_messages_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const newMsg = payload.new
          if (!newMsg) return

          // Dacă e chatul activ + panel deschis → adaugă în messages + mark read
          if (newMsg.chat_id === activeChatId && open) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev
              return [...prev, newMsg]
            })
            // Mark as read pentru că vede mesajul live
            if (newMsg.sender_id !== currentUserId) {
              setTimeout(() => markAsRead(newMsg.chat_id), 500)
            }
          } else {
            // Alt chat sau panel închis → refresh lista + notificare
            loadChats()
            
            // Browser notification dacă NU e mesajul propriu și panel-ul e închis sau alt chat
            if (newMsg.sender_id !== currentUserId && lastNotifiedMsgIdRef.current !== newMsg.id) {
              lastNotifiedMsgIdRef.current = newMsg.id
              // Fetch sender name + chat name pentru notification
              ;(async () => {
                try {
                  const [{ data: sender }, { data: chat }] = await Promise.all([
                    supabase.from('profiles').select('name, email').eq('id', newMsg.sender_id).maybeSingle(),
                    supabase.from('internal_chats').select('name, avatar_emoji').eq('id', newMsg.chat_id).maybeSingle(),
                  ])
                  const senderName = sender?.name || sender?.email?.split('@')[0] || 'Cineva'
                  const chatName = chat?.name || 'Chat Gazpet'
                  const emoji = chat?.avatar_emoji || '💬'
                  showBrowserNotification(
                    `${emoji} ${chatName}`,
                    `${senderName}: ${newMsg.content}`
                  )
                } catch (e) {
                  console.warn('Notification fetch error:', e)
                }
              })()
            }
          }
        }
      )
      .subscribe()

    realtimeChannelRef.current = channel

    return () => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current)
        realtimeChannelRef.current = null
      }
    }
  }, [currentUserId, activeChatId, open, loadChats, markAsRead, showBrowserNotification])

  // ─── Auto-scroll messages la mesaj nou ─────────────────────────────
  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollTo({ top: messagesEndRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, open])

  // ─── Focus input la deschidere ──────────────────────────────────────
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, activeChatId])

  // ─── Periodic refresh chats every 60s (fallback realtime) ──────────
  useEffect(() => {
    if (!currentUserId) return
    const interval = setInterval(loadChats, 60000)
    return () => clearInterval(interval)
  }, [currentUserId, loadChats])

  // ─── Listen for external toggle events (button în navbar) ──────────
  useEffect(() => {
    const toggleHandler = (e) => {
      if (e.detail && typeof e.detail.open === 'boolean') {
        setOpen(e.detail.open)
      } else {
        setOpen(o => !o)
      }
    }
    window.addEventListener('gazpet:chat-toggle', toggleHandler)
    return () => window.removeEventListener('gazpet:chat-toggle', toggleHandler)
  }, [])

  // ─── Dispatch unread count to navbar button ─────────────────────────
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('gazpet:chat-unread', { detail: { count: totalUnread } }))
  }, [totalUnread])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeChat = chats.find(c => c.id === activeChatId)
  const senderMap = new Map(members.map(m => [m.user_id, m]))
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [showNewChatModal, setShowNewChatModal] = useState(false)

  if (!currentUserId) return null

  return (
    <>
      {/* CHAT PANEL (butonul e în navbar via App.jsx Layout) */}
      {open && (
        <div style={{
          position: 'fixed',
          top: 64,
          right: 12,
          width: 'min(820px, calc(100vw - 24px))',
          height: 'calc(100vh - 84px)',
          background: G.surface,
          border: `1px solid ${G.border2}`,
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          display: 'flex',
          zIndex: 9995,
          overflow: 'hidden',
        }}>
          {/* SIDEBAR CHATS */}
          <div style={{
            width: 270,
            background: G.bg,
            borderRight: `1px solid ${G.border}`,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Sidebar header */}
            <div style={{
              padding: '12px 14px',
              borderBottom: `1px solid ${G.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>Chat-uri</div>
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  onClick={() => setShowNewChatModal(true)}
                  title="Chat nou"
                  style={{
                    background: G.primary + '22',
                    border: `1px solid ${G.primary}55`,
                    color: G.blue,
                    borderRadius: 6,
                    padding: '4px 9px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}>
                  ➕
                </button>
                <button
                  onClick={requestNotificationPermission}
                  title={notifyEnabled ? 'Notificări active' : 'Activează notificări browser'}
                  style={{
                    background: notifyEnabled ? G.green + '22' : 'transparent',
                    border: `1px solid ${notifyEnabled ? G.green : G.border}`,
                    color: notifyEnabled ? G.green : G.muted,
                    borderRadius: 6,
                    padding: '4px 7px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}>
                  {notifyEnabled ? '🔔' : '🔕'}
                </button>
              </div>
            </div>
            
            {/* Chats list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {chats.length === 0 ? (
                <div style={{ padding: 20, color: G.muted, fontSize: 13, textAlign: 'center' }}>
                  Niciun chat încă.
                </div>
              ) : chats.map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveChatId(c.id)}
                  style={{
                    width: '100%',
                    background: activeChatId === c.id ? G.primary + '22' : 'transparent',
                    border: 'none',
                    borderLeft: activeChatId === c.id ? `3px solid ${G.primary}` : '3px solid transparent',
                    color: G.text,
                    textAlign: 'left',
                    padding: '13px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (activeChatId !== c.id) e.currentTarget.style.background = G.border }}
                  onMouseLeave={e => { if (activeChatId !== c.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%',
                    background: c.is_general ? G.primary : G.purple + '44',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, flexShrink: 0,
                  }}>{c.avatar_emoji || '💬'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 16, fontWeight: 700, color: G.text,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      {c.my_role === 'admin' && (
                        <span style={{ fontSize: 11, color: G.yellow, fontWeight: 700 }}>👑</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 13, color: G.muted, marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.last_message ? c.last_message : 'Niciun mesaj încă'}
                    </div>
                  </div>
                  {c.unread_count > 0 && (
                    <span style={{
                      background: G.red,
                      color: '#fff',
                      borderRadius: 10,
                      padding: '2px 7px',
                      fontSize: 12,
                      fontWeight: 800,
                      minWidth: 22,
                      textAlign: 'center',
                    }}>{c.unread_count > 99 ? '99+' : c.unread_count}</span>
                  )}
                </button>
              ))}
            </div>
            
            {/* Sidebar footer */}
            <div style={{
              padding: 10,
              borderTop: `1px solid ${G.border}`,
              fontSize: 12,
              color: G.dim,
              textAlign: 'center',
            }}>
              {chats.length} chat-uri · Tu: <span style={{ color: G.text, fontWeight: 600 }}>{profile.name?.split(' ').slice(-1)[0] || 'User'}</span>
            </div>
          </div>

          {/* MAIN AREA */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {activeChat ? (
              <>
                {/* Header */}
                <div style={{
                  padding: '12px 18px',
                  borderBottom: `1px solid ${G.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: `linear-gradient(135deg, ${G.primary}10, ${G.purple}10)`,
                }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: '50%',
                    background: activeChat.is_general ? G.primary : G.purple + '44',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24, flexShrink: 0,
                  }}>{activeChat.avatar_emoji || '💬'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: G.text }}>{activeChat.name}</div>
                    <div style={{ fontSize: 13, color: G.muted, marginTop: 2 }}>
                      {activeChat.total_members} membri · {members.filter(m => m.member_role === 'admin').length} admini
                      {activeChat.my_role === 'admin' && <span style={{ color: G.yellow, marginLeft: 6 }}>· Tu ești ADMIN 👑</span>}
                    </div>
                  </div>
                  {activeChat.my_role === 'admin' && (
                    <button
                      title="Setări membri & admini"
                      onClick={() => setShowAdminModal(true)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${G.border}`,
                        color: G.muted,
                        borderRadius: 6,
                        padding: '6px 9px',
                        fontSize: 14,
                        cursor: 'pointer',
                      }}>
                      ⚙️
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    title="Închide"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: G.muted,
                      fontSize: 26,
                      cursor: 'pointer',
                      lineHeight: 1,
                      padding: 0,
                      width: 30,
                    }}>×</button>
                </div>

                {/* Messages */}
                <div 
                  ref={messagesEndRef}
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}>
                  {messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: G.muted, fontSize: 17, marginTop: 50 }}>
                      Niciun mesaj încă. Începe conversația! 👋
                    </div>
                  ) : messages.map((m, idx) => {
                    const isOwn = m.sender_id === currentUserId
                    const sender = senderMap.get(m.sender_id)
                    const senderName = sender?.name || 'Necunoscut'
                    const prevMsg = messages[idx - 1]
                    const showSender = !prevMsg || prevMsg.sender_id !== m.sender_id
                    
                    return (
                      <div key={m.id} style={{
                        display: 'flex',
                        flexDirection: isOwn ? 'row-reverse' : 'row',
                        alignItems: 'flex-start',
                        gap: 8,
                        marginTop: showSender ? 4 : 0,
                      }}>
                        {/* Avatar - doar la primul mesaj din streak */}
                        <div style={{ width: 38, flexShrink: 0 }}>
                          {showSender && <Avatar name={senderName} userId={m.sender_id} size={38} />}
                        </div>
                        <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                          {showSender && !isOwn && (
                            <div style={{ fontSize: 13, color: G.muted, marginBottom: 4, marginLeft: 4, fontWeight: 600 }}>
                              {senderName}
                            </div>
                          )}
                          <div style={{
                            padding: '8px 13px',
                            borderRadius: 12,
                            background: isOwn ? G.primary : G.bg,
                            color: isOwn ? '#fff' : G.text,
                            border: isOwn ? 'none' : `1px solid ${G.border}`,
                            fontSize: 18,
                            lineHeight: 1.45,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {m.content}
                          </div>
                          <div style={{ fontSize: 11, color: G.dim, marginTop: 3, padding: '0 4px' }}>
                            {formatTime(m.created_at)}
                            {m.edited_at && <span style={{ marginLeft: 4 }}>· editat</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Composer */}
                <div style={{
                  padding: '10px 14px',
                  borderTop: `1px solid ${G.border}`,
                  background: G.bg,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Scrie un mesaj..."
                      rows={1}
                      disabled={sending}
                      style={{
                        flex: 1,
                        background: G.surface,
                        border: `1px solid ${G.border2}`,
                        color: G.text,
                        borderRadius: 8,
                        padding: '12px 16px',
                        fontSize: 18,
                        fontFamily: 'inherit',
                        resize: 'none',
                        minHeight: 48,
                        maxHeight: 120,
                        outline: 'none',
                        opacity: sending ? 0.6 : 1,
                        lineHeight: 1.4,
                      }}
                      onFocus={e => { e.target.style.borderColor = G.primary }}
                      onBlur={e => { e.target.style.borderColor = G.border2 }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={sending || !input.trim()}
                      style={{
                        background: (sending || !input.trim()) ? G.border2 : G.primary,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        padding: '12px 20px',
                        fontSize: 19,
                        fontWeight: 800,
                        cursor: (sending || !input.trim()) ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        minHeight: 48,
                      }}>
                      {sending ? '⏳' : '➤'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: G.dim, marginTop: 6, textAlign: 'center' }}>
                    Enter = trimite · Shift+Enter = linie nouă
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: G.muted, fontSize: 14, padding: 40, textAlign: 'center' }}>
                Selectează un chat din stânga
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* MODAL ADMIN: gestionează membri */}
      {showAdminModal && activeChat && (
        <AdminChatModal
          chat={activeChat}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setShowAdminModal(false)}
          onUpdate={() => {
            loadMembers(activeChatId)
            loadChats()
          }}
        />
      )}
      
      {/* MODAL CHAT NOU */}
      {showNewChatModal && (
        <NewChatModal
          currentUserId={currentUserId}
          onClose={() => setShowNewChatModal(false)}
          onCreated={(newChatId) => {
            setShowNewChatModal(false)
            loadChats().then(() => setActiveChatId(newChatId))
          }}
        />
      )}
    </>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// MODAL ADMIN: gestionează membri + admini (max 3 admini)
// ════════════════════════════════════════════════════════════════════════════
function AdminChatModal({ chat, members, currentUserId, onClose, onUpdate }) {
  const [allUsers, setAllUsers] = useState([])
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  
  const adminCount = members.filter(m => m.member_role === 'admin').length
  const memberIds = new Set(members.map(m => m.user_id))
  
  useEffect(() => {
    if (!showAdd) return
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, email, role')
          .order('name', { ascending: true })
        if (error) throw error
        setAllUsers(data || [])
      } catch (e) {
        console.error('loadAllUsers error:', e)
      }
    })()
  }, [showAdd])
  
  const addMember = async (userId) => {
    setBusyId(userId)
    try {
      const { error } = await supabase
        .from('chat_members')
        .insert({ chat_id: chat.id, user_id: userId, member_role: 'member' })
      if (error) throw error
      onUpdate()
    } catch (e) {
      alert('Eroare: ' + e.message)
    } finally {
      setBusyId(null)
    }
  }
  
  const removeMember = async (userId) => {
    if (userId === currentUserId) {
      if (!confirm('Vrei să PĂRĂSEȘTI chatul?')) return
    } else {
      if (!confirm('Sigur scoți userul din chat?')) return
    }
    setBusyId(userId)
    try {
      const { error } = await supabase
        .from('chat_members')
        .delete()
        .eq('chat_id', chat.id)
        .eq('user_id', userId)
      if (error) throw error
      onUpdate()
      if (userId === currentUserId) onClose()
    } catch (e) {
      alert('Eroare: ' + e.message)
    } finally {
      setBusyId(null)
    }
  }
  
  const toggleAdmin = async (userId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    if (newRole === 'admin' && adminCount >= 3) {
      alert('⚠️ Max 3 admini per chat. Retrogradează unul mai întâi.')
      return
    }
    if (newRole === 'member' && adminCount <= 1) {
      alert('⚠️ Trebuie să fie minim 1 admin. Promovează pe altcineva mai întâi.')
      return
    }
    setBusyId(userId)
    try {
      const { error } = await supabase
        .from('chat_members')
        .update({ member_role: newRole })
        .eq('chat_id', chat.id)
        .eq('user_id', userId)
      if (error) throw error
      onUpdate()
    } catch (e) {
      alert('Eroare: ' + e.message)
    } finally {
      setBusyId(null)
    }
  }
  
  const filteredUsers = allUsers.filter(u => 
    !memberIds.has(u.id) && 
    (u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))
  )
  
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 14,
        width: 'min(560px, calc(100vw - 32px))', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,.7)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>⚙️ Setări „{chat.name}"</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              {members.length} membri · {adminCount}/3 admini
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: G.muted, fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
          {!showAdd ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: G.muted, fontWeight: 700 }}>MEMBRI</div>
                <button onClick={() => setShowAdd(true)} style={{
                  background: G.primary, color: '#fff', border: 'none', borderRadius: 6,
                  padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}>+ Adaugă membru</button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map(m => {
                  const isAdmin = m.member_role === 'admin'
                  const isMe = m.user_id === currentUserId
                  return (
                    <div key={m.user_id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', background: G.bg, border: `1px solid ${G.border}`,
                      borderRadius: 8,
                    }}>
                      <Avatar name={m.name} userId={m.user_id} size={34} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: G.text }}>
                          {m.name} {isMe && <span style={{ color: G.muted, fontWeight: 400 }}>(tu)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: G.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
                          {isAdmin && <span style={{ color: G.yellow, fontWeight: 700 }}>👑 ADMIN</span>}
                          {m.role && <span>· {m.role}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button
                          onClick={() => toggleAdmin(m.user_id, m.member_role)}
                          disabled={busyId === m.user_id}
                          title={isAdmin ? 'Retrogradează la membru' : 'Promovează la admin'}
                          style={{
                            background: isAdmin ? G.yellow + '22' : 'transparent',
                            color: isAdmin ? G.yellow : G.muted,
                            border: `1px solid ${isAdmin ? G.yellow : G.border}`,
                            borderRadius: 6, padding: '5px 9px', fontSize: 13, cursor: 'pointer', fontWeight: 700,
                          }}>
                          {isAdmin ? '⬇️' : '⬆️'}
                        </button>
                        <button
                          onClick={() => removeMember(m.user_id)}
                          disabled={busyId === m.user_id}
                          title={isMe ? 'Părăsește chat' : 'Scoate din chat'}
                          style={{
                            background: G.red + '22', color: G.red,
                            border: `1px solid ${G.red}55`,
                            borderRadius: 6, padding: '5px 9px', fontSize: 13, cursor: 'pointer', fontWeight: 700,
                          }}>
                          {isMe ? '🚪' : '🗑'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: G.muted, fontWeight: 700 }}>ADAUGĂ MEMBRU</div>
                <button onClick={() => setShowAdd(false)} style={{
                  background: 'transparent', color: G.muted, border: `1px solid ${G.border}`,
                  borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                }}>← Înapoi</button>
              </div>
              
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Caută după nume sau email..."
                autoFocus
                style={{
                  width: '100%', background: G.bg, border: `1px solid ${G.border2}`,
                  color: G.text, borderRadius: 8, padding: '10px 14px', fontSize: 14,
                  marginBottom: 10, outline: 'none', boxSizing: 'border-box',
                }}
              />
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 400, overflowY: 'auto' }}>
                {filteredUsers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 20, color: G.muted, fontSize: 13 }}>
                    {search ? 'Niciun user găsit' : 'Toți userii sunt deja membri'}
                  </div>
                ) : filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => addMember(u.id)}
                    disabled={busyId === u.id}
                    style={{
                      background: G.bg, border: `1px solid ${G.border}`, borderRadius: 8,
                      padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = G.primary + '22' }}
                    onMouseLeave={e => { e.currentTarget.style.background = G.bg }}
                  >
                    <Avatar name={u.name} userId={u.id} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: G.text }}>{u.name || u.email}</div>
                      <div style={{ fontSize: 10, color: G.muted }}>{u.role || u.email}</div>
                    </div>
                    <span style={{ color: G.green, fontSize: 18 }}>+</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}


// ════════════════════════════════════════════════════════════════════════════
// MODAL CHAT NOU
// ════════════════════════════════════════════════════════════════════════════
function NewChatModal({ currentUserId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [creating, setCreating] = useState(false)
  
  const emojiOptions = ['💬', '🏗️', '🚛', '👥', '⚡', '🔧', '📋', '🎯', '🛠️', '🚨', '🎉', '☕']
  
  const create = async () => {
    if (!name.trim()) {
      alert('Numele chat-ului e obligatoriu')
      return
    }
    setCreating(true)
    try {
      // 1. Creează chatul
      const { data: chat, error: chatErr } = await supabase
        .from('internal_chats')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          chat_type: 'group',
          is_general: false,
          avatar_emoji: emoji,
          created_by: currentUserId,
        })
        .select()
        .single()
      if (chatErr) throw chatErr
      
      // 2. Adăugă creator-ul ca ADMIN
      const { error: memErr } = await supabase
        .from('chat_members')
        .insert({
          chat_id: chat.id,
          user_id: currentUserId,
          member_role: 'admin',
        })
      if (memErr) throw memErr
      
      onCreated(chat.id)
    } catch (e) {
      alert('Eroare la creare: ' + e.message)
    } finally {
      setCreating(false)
    }
  }
  
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 14,
        width: 'min(480px, calc(100vw - 32px))',
        boxShadow: '0 20px 60px rgba(0,0,0,.7)', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${G.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: G.text }}>➕ Chat nou</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: G.muted, fontSize: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Emoji */}
          <div>
            <div style={{ fontSize: 12, color: G.muted, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Iconiță</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {emojiOptions.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  style={{
                    width: 38, height: 38, borderRadius: 8, fontSize: 20,
                    background: emoji === e ? G.primary + '33' : G.bg,
                    border: `1.5px solid ${emoji === e ? G.primary : G.border}`,
                    cursor: 'pointer',
                  }}>{e}</button>
              ))}
            </div>
          </div>
          
          {/* Nume */}
          <div>
            <div style={{ fontSize: 12, color: G.muted, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Nume *</div>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ex: Șantier Mihăești, Echipa Tehnică..."
              autoFocus
              maxLength={80}
              style={{
                width: '100%', background: G.bg, border: `1px solid ${G.border2}`,
                color: G.text, borderRadius: 8, padding: '10px 14px', fontSize: 14,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          
          {/* Descriere */}
          <div>
            <div style={{ fontSize: 12, color: G.muted, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>Descriere (opțional)</div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="La ce folosește chatul"
              rows={2}
              maxLength={200}
              style={{
                width: '100%', background: G.bg, border: `1px solid ${G.border2}`,
                color: G.text, borderRadius: 8, padding: '10px 14px', fontSize: 13,
                outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
              }}
            />
          </div>
          
          <div style={{ fontSize: 11, color: G.muted, padding: '8px 10px', background: G.primary + '11', borderRadius: 6, border: `1px solid ${G.primary}33` }}>
            ℹ️ Tu vei fi ADMIN. Adaugi membrii din ⚙️ Setări după ce creezi chat-ul (max 3 admini).
          </div>
        </div>
        
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${G.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{
            background: 'transparent', color: G.muted, border: `1px solid ${G.border}`,
            borderRadius: 8, padding: '9px 18px', fontSize: 13, cursor: 'pointer',
          }}>Anulează</button>
          <button
            onClick={create}
            disabled={creating || !name.trim()}
            style={{
              background: (creating || !name.trim()) ? G.border2 : G.primary,
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 18px', fontSize: 14, fontWeight: 700,
              cursor: (creating || !name.trim()) ? 'default' : 'pointer',
            }}>
            {creating ? '⏳ Creez...' : '✓ Creează chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
