import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { useChat } from '../../hooks/useChat'

function getDateLabel(dateStr) {
  const d         = new Date(dateStr)
  const now       = new Date()
  const yesterday = new Date(now.getTime() - 86400000)
  if (d.toDateString() === now.toDateString())       return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

function renderMarkdown(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

const SUGGESTIONS = [
  'Who is my strongest candidate right now?',
  "What's the overall health of my hiring pipeline?",
  'Compare my top candidates for the most active role',
  'What are common interview red flags to watch for?',
  'How can I reduce my time-to-hire?',
  'What salary range is competitive for my open roles?',
]

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2.5 3.5h8M5.5 3.5V2.5h2v1M4.5 3.5v7h4v-7h-4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function ClientChat() {
  const { user } = useAuth()
  const [input,       setInput]       = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  const {
    conversations, activeId, messages, loading, sending, convsLoading,
    loadConversations, createConversation, switchConversation,
    deleteConversation, clearCurrentConversation, sendMessage,
  } = useChat(user?.id)

  // On mount: load conversations and auto-open the most recent
  useEffect(() => {
    if (!user?.id) return
    loadConversations().then(convs => {
      if (convs?.length) switchConversation(convs[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const handleNew = async () => {
    await createConversation()
    setSidebarOpen(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleSwitch = async (id) => {
    await switchConversation(id)
    setSidebarOpen(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    const idx      = conversations.findIndex(c => c.id === id)
    const wasActive = id === activeId
    await deleteConversation(id)
    if (wasActive) {
      const remaining = conversations.filter(c => c.id !== id)
      if (remaining.length > 0) {
        await switchConversation(remaining[Math.min(idx, remaining.length - 1)].id)
      } else {
        clearCurrentConversation()
      }
    }
  }

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    await sendMessage(text)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleTextareaChange = (e) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  // Build message items with date separators
  const items = []
  let lastDate = null
  for (const msg of messages) {
    const label = getDateLabel(msg.created_at)
    if (label !== lastDate) {
      items.push({ type: 'sep', label, id: `sep-${msg.id}` })
      lastDate = label
    }
    items.push({ type: 'msg', msg, id: String(msg.id) })
  }

  const activeConv = conversations.find(c => c.id === activeId)

  return (
    <div className="hchat-page">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="hchat-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Conversation sidebar ── */}
      <div className={`hchat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="hchat-sidebar-top">
          <button className="hchat-new-conv-btn" onClick={handleNew}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
              <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New Conversation
          </button>
        </div>

        <div className="hchat-sidebar-list">
          {convsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
            </div>
          ) : conversations.length === 0 ? (
            <p style={{ padding: '14px 12px', fontSize: 12, color: 'var(--text-3)', fontWeight: 300 }}>
              No conversations yet.
            </p>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={`hchat-conv-item ${conv.id === activeId ? 'active' : ''}`}
                onClick={() => handleSwitch(conv.id)}
              >
                <div className="hchat-conv-body">
                  <div className="hchat-conv-title">{conv.title}</div>
                  <div className="hchat-conv-date">
                    {new Date(conv.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <button
                  className="hchat-conv-del"
                  onClick={e => handleDelete(e, conv.id)}
                  title="Delete conversation"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="hchat-main">

        {/* Header */}
        <div className="hchat-page-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <button
              className="hchat-menu-btn hchat-menu-btn-mobile"
              onClick={() => setSidebarOpen(o => !o)}
              title="Conversations"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>OS</div>
            <div>
              <strong style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-body)' }}>One Select Assistant</strong>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>Pipeline copilot · always on</span>
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ flexShrink: 0, fontSize: 11, padding: '6px 12px' }}
            onClick={handleNew}
          >
            + New chat
          </button>
        </div>

        {/* Messages */}
        <div className="hchat-page-msgs">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
              <span className="spinner" style={{ width: 24, height: 24 }} />
            </div>
          ) : messages.length === 0 ? (
            <div className="hchat-empty" style={{ flex: 1, padding: '48px 24px' }}>
              <div className="hchat-empty-icon" style={{ fontSize: 44 }}>◎</div>
              <h4 style={{
                fontSize: 22, fontFamily: 'var(--font-head)', fontWeight: 400,
                marginBottom: 8, color: 'var(--text)', textTransform: 'none', letterSpacing: 0,
              }}>
                Your AI Hiring Advisor
              </h4>
              <p style={{ fontSize: 14, maxWidth: 440, lineHeight: 1.7, marginBottom: 32 }}>
                I have live access to your pipeline, candidate scores, and interview data.
                Ask me anything.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 520 }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    className="sug"
                    onClick={() => { setInput(s); inputRef.current?.focus() }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            items.map(item =>
              item.type === 'sep' ? (
                <div key={item.id} className="hchat-date-sep">
                  <span>{item.label}</span>
                </div>
              ) : (
                <div key={item.id} className={`hchat-row ${item.msg.role}`}>
                  <div className="hchat-row-av" style={{ width: 30, height: 30, fontSize: 9 }}>
                    {item.msg.role === 'assistant' ? 'OS' : 'You'}
                  </div>
                  <div
                    className="hchat-bubble-msg"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.msg.message) }}
                  />
                </div>
              )
            )
          )}

          {sending && (
            <div className="hchat-typing-row">
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--accent)', color: '#fff', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 9,
              }}>OS</div>
              <div className="hchat-typing-bubble">
                <div className="typing-dots"><span /><span /><span /></div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="hchat-page-input">
          <textarea
            ref={inputRef}
            className="hchat-input"
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your candidates, pipeline health, or get hiring advice… (Enter to send, Shift+Enter for new line)"
            rows={1}
            autoFocus
          />
          <button
            className="hchat-send"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            style={{ width: 42, height: 42, borderRadius: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M16 9H2M16 9L10 3M16 9L10 15" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  )
}
