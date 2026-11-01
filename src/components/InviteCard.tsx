import { useState } from 'react'
import { IconCopy, IconCheck, IconShare } from './Icons'
import { QrCode } from './QrCode'
import { shareInvite } from '../lib/share'
import styles from './Room.module.css'

export function InviteCard(args: { roomId: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'unavailable'>('idle')
  const copy = () => {
    void navigator.clipboard.writeText(args.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const share = () => {
    void shareInvite({ url: args.url, roomId: args.roomId }).then((result) => {
      if (result === 'shared' || result === 'unavailable') {
        setShareState(result)
        setTimeout(() => setShareState('idle'), 3000)
      }
    })
  }
  return (
    <div className={styles.inviteCard} data-testid="invite-card">
      <div className="pulse-dot" />
      <h2 className={styles.inviteTitle}>Waiting for others</h2>
      <p className="dim">Share this room. Nobody else is here yet.</p>
      <code className={styles.inviteUrl}>{args.url}</code>
      <div className={styles.inviteActions}>
        <button className="btn-primary" type="button" onClick={copy}>
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          {copied ? 'Copied' : 'Copy invite'}
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={share}
          title="Opens your device's share sheet. Copy invite is the button next to it."
        >
          {shareState === 'shared' ? <IconCheck size={14} /> : <IconShare size={14} />}
          {shareState === 'shared' ? 'Shared' : shareState === 'unavailable' ? 'Unavailable' : 'Share'}
        </button>
      </div>
      <div className={styles.inviteQr}>
        <QrCode text={args.url} label={`QR code for room ${args.roomId}`} />
      </div>
    </div>
  )
}
