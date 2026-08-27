import { useEffect, useState } from 'react'

export function useMicLevel(args: { stream: MediaStream | null; active: boolean }): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!args.stream || !args.active) {
      setLevel(0)
      return
    }
    const track = args.stream.getAudioTracks()[0]
    if (!track) {
      setLevel(0)
      return
    }

    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(new MediaStream([track]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.65
    source.connect(analyser)
    const data = new Uint8Array(analyser.fftSize)
    let raf = 0

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const sample of data) {
        const n = (sample - 128) / 128
        sum += n * n
      }
      const rms = Math.sqrt(sum / data.length)
      setLevel(Math.min(1, rms * 4.5))
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void ctx.close()
    }
  }, [args.stream, args.active])

  return level
}
