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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const activeChat = chats.find(c => c.id === activeChatId)
  const senderMap = new Map(members.map(m => [m.user_id, m]))

  if (!currentUserId) return null

  return (
    <>
      {/* FLOATING BUTTON sus dreapta */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Chat intern Gazpet"
        style={{
          position: 'fixed',
          top: 12,
          right: 200,
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: open ? G.red : G.primary,
          color: '#fff',
          border: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,.4)',
          cursor: 'pointer',
          fontSize: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9996,
          transition: 'all .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
      >
        {open ? '×' : '💬'}
        {/* Badge unread */}
        {!open && totalUnread > 0 && (
          <span style={{
            position: 'absolute',
            top: -4,
            right: -4,
            background: G.red,
            color: '#fff',
            borderRadius: '50%',
            minWidth: 18,
            height: 18,
            fontSize: 11,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px solid ${G.bg}`,
            padding: '0 5px',
            animation: 'ic-pulse 1.5s ease-in-out infinite',
          }}>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
        <style>{`@keyframes ic-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.15) } }`}</style>
      </button>

      {/* CHAT PANEL */}
      {open && (
        <div style={{
          position: 'fixed',
          top: 64,
          right: 12,
          width: 'min(720px, calc(100vw - 24px))',
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
            width: 240,
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
              <div style={{ fontSize: 14, fontWeight: 800, color: G.text }}>Chat-uri</div>
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
                    padding: '11px 13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (activeChatId !== c.id) e.currentTarget.style.background = G.border }}
                  onMouseLeave={e => { if (activeChatId !== c.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: c.is_general ? G.primary : G.purple + '44',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, flexShrink: 0,
                  }}>{c.avatar_emoji || '💬'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: G.text,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      {c.my_role === 'admin' && (
                        <span style={{ fontSize: 9, color: G.yellow, fontWeight: 700 }}>👑</span>
                      )}
                    </div>
                    <div style={{
                      fontSize: 11, color: G.muted, marginTop: 1,
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
                      fontSize: 10,
                      fontWeight: 800,
                      minWidth: 18,
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
              fontSize: 10,
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
                    width: 40, height: 40, borderRadius: '50%',
                    background: activeChat.is_general ? G.primary : G.purple + '44',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, flexShrink: 0,
                  }}>{activeChat.avatar_emoji || '💬'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: G.text }}>{activeChat.name}</div>
                    <div style={{ fontSize: 11, color: G.muted, marginTop: 1 }}>
                      {activeChat.total_members} membri · {members.filter(m => m.member_role === 'admin').length} admini
                      {activeChat.my_role === 'admin' && <span style={{ color: G.yellow, marginLeft: 6 }}>· Tu ești ADMIN 👑</span>}
                    </div>
                  </div>
                  {activeChat.my_role === 'admin' && (
                    <button
                      title="Setări chat (în curând în Partea 2)"
                      onClick={() => alert('⚙️ Setări admini va veni în Partea 2!\nVei putea invita/scoate membri și promova/retrograda admini (max 3).')}
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
                    <div style={{ textAlign: 'center', color: G.muted, fontSize: 14, marginTop: 40 }}>
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
                        <div style={{ width: 32, flexShrink: 0 }}>
                          {showSender && <Avatar name={senderName} userId={m.sender_id} size={32} />}
                        </div>
                        <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                          {showSender && !isOwn && (
                            <div style={{ fontSize: 11, color: G.muted, marginBottom: 3, marginLeft: 4 }}>
                              {senderName}
                            </div>
                          )}
                          <div style={{
                            padding: '8px 13px',
                            borderRadius: 12,
                            background: isOwn ? G.primary : G.bg,
                            color: isOwn ? '#fff' : G.text,
                            border: isOwn ? 'none' : `1px solid ${G.border}`,
                            fontSize: 15,
                            lineHeight: 1.4,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}>
                            {m.content}
                          </div>
                          <div style={{ fontSize: 9, color: G.dim, marginTop: 2, padding: '0 4px' }}>
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
                        padding: '10px 14px',
                        fontSize: 15,
                        fontFamily: 'inherit',
                        resize: 'none',
                        minHeight: 42,
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
                        padding: '10px 18px',
                        fontSize: 16,
                        fontWeight: 800,
                        cursor: (sending || !input.trim()) ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                        minHeight: 42,
                      }}>
                      {sending ? '⏳' : '➤'}
                    </button>
                  </div>
                  <div style={{ fontSize: 9, color: G.dim, marginTop: 5, textAlign: 'center' }}>
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
    </>
  )
}
