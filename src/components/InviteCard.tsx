import { useState } from 'react'
import { IconCopy, IconCheck } from './Icons'
import { QrCode } from './QrCode'
import styles from './Room.module.css'

export function InviteCard(args: { roomId: string; url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(args.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className={styles.inviteCard} data-testid="invite-card">
      <div className="pulse-dot" />
      <h2 className={styles.inviteTitle}>Waiting for others</h2>
      <p className="dim">Share this room. Nobody else is here yet.</p>
      <code className={styles.inviteUrl}>{args.url}</code>
      <button className="btn-primary" type="button" onClick={copy}>
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        {copied ? 'Copied' : 'Copy invite'}
      </button>
      <div className={styles.inviteQr}>
        <QrCode text={args.url} label={`QR code for room ${args.roomId}`} />
      </div>
    </div>
  )
}
