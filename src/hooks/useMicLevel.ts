import { useEffect, useState } from 'react'

let shared: { context: AudioContext; users: number } | null = null

/** Analyse existing audio tracks without playing them or asking for a microphone. */
export function useMicLevel(args: { stream: MediaStream | null; active: boolean }): number {
  const [level, setLevel] = useState(0)
  const track = args.stream?.getAudioTracks()[0] ?? null
  useEffect(() => {
    if (!track || !args.active || typeof AudioContext === 'undefined') {
      setLevel(0)
      return
    }
    if (!shared || shared.context.state === 'closed') shared = { context: new AudioContext(), users: 0 }
    const owner = shared
    owner.users++
    const ctx = owner.context
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    const resume = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}) }
    resume()
    document.addEventListener('pointerdown', resume)
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const sample of data) sum += ((sample - 128) / 128) ** 2
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4.5))
    }, 80)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('pointerdown', resume)
      source.disconnect()
      analyser.disconnect()
      if (--owner.users === 0) {
        if (shared === owner) shared = null
        void ctx.close().catch(() => {})
      }
    }
  }, [track, args.active])
  return level
}
