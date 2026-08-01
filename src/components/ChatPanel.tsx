import { useState, useRef, useEffect } from 'react'
import type { ChatEntry } from '../hooks/useSignaling'
import styles from './Room.module.css'

interface ChatPanelProps {
  chat: ChatEntry[]
  myId: string
  onSend: (text: string) => void
}

export function ChatPanel({ chat, myId, onSend }: ChatPanelProps) {
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chat])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatHeader}>
        <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Chat</span>
        <span className="dim" style={{ fontSize: '0.7rem' }}>{chat.length} messages</span>
      </div>
      <div className={styles.chatMessages} ref={scrollRef}>
        {chat.map((entry) => (
          <div key={entry.id} className={styles.chatMsg}>
            <span className={styles.chatName} style={{ color: entry.from === myId ? 'var(--accent)' : undefined }}>
              {entry.from === myId ? 'You' : entry.name}
            </span>
            <span className={styles.chatText}>{entry.text}</span>
          </div>
        ))}
        {chat.length === 0 && (
          <div className="dim" style={{ fontSize: '0.8rem', padding: '1rem' }}>
            No messages yet. Say hello!
          </div>
        )}
      </div>
      <div className={styles.chatInput}>
        <input
          type="text"
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          maxLength={2000}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn-primary" onClick={send} disabled={!text.trim()}>
          →
        </button>
      </div>
    </div>
  )
}
