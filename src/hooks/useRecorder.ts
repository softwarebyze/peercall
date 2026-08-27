import { useRef, useState, useCallback } from 'react'

export type RecorderStart =
  | { kind: 'ok' }
  | { kind: 'no_video'; message: string }
  | { kind: 'failed'; message: string }

export type RecorderStop = { kind: 'saved' } | { kind: 'empty' } | { kind: 'idle' }

export interface RecorderState {
  recording: boolean
  duration: number
  start: (stream: MediaStream) => Promise<RecorderStart>
  stop: () => Promise<RecorderStop>
}

type VideoSource = { add: (timestamp: number, duration: number) => void }

type OutputHandle = {
  state: string
  format: { mimeType: string }
  target: { buffer: ArrayBuffer | null }
  finalize: () => Promise<void>
}

const CODECS = ['avc', 'av1'] as const

export function useRecorder(): RecorderState {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const outputRef = useRef<OutputHandle | null>(null)
  const rafRef = useRef(0)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const framesRef = useRef(0)
  const startTimeRef = useRef(0)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const videoSourceRef = useRef<VideoSource | null>(null)

  const resetLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    if (videoElRef.current) {
      videoElRef.current.pause()
      videoElRef.current.srcObject = null
      videoElRef.current = null
    }
    canvasRef.current = null
    ctxRef.current = null
    videoSourceRef.current = null
  }

  const start = useCallback(async (stream: MediaStream): Promise<RecorderStart> => {
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) {
      return { kind: 'no_video', message: 'Recording needs a camera or screen share.' }
    }

    try {
      const {
        Output,
        Mp4OutputFormat,
        BufferTarget,
        CanvasSource,
        MediaStreamAudioTrackSource,
      } = await import('mediabunny')

      const canvas = document.createElement('canvas')
      const videoSettings = videoTrack.getSettings()
      canvas.width = videoSettings.width ?? 1280
      canvas.height = videoSettings.height ?? 720
      const ctx = canvas.getContext('2d')
      if (!ctx) return { kind: 'failed', message: 'Could not start recording.' }

      const videoEl = document.createElement('video')
      videoEl.srcObject = new MediaStream([videoTrack])
      videoEl.muted = true
      videoEl.playsInline = true
      await videoEl.play()

      const audioTrack = stream.getAudioTracks()[0]
      let started: { output: OutputHandle; videoSource: VideoSource } | null = null
      let lastMessage = 'Could not start recording on this browser.'

      for (const codec of CODECS) {
        try {
          const output = new Output({
            format: new Mp4OutputFormat(),
            target: new BufferTarget(),
          }) as OutputHandle & {
            addVideoTrack: (source: VideoSource, opts: { frameRate: number }) => void
            addAudioTrack: (source: unknown) => void
            start: () => Promise<void>
          }
          const videoSource = new CanvasSource(canvas, {
            codec,
            bitrate: 2_000_000,
          }) as VideoSource
          output.addVideoTrack(videoSource, { frameRate: 30 })
          if (audioTrack) {
            const audioSource = new MediaStreamAudioTrackSource(audioTrack, {
              codec: 'opus',
              bitrate: 128_000,
            })
            output.addAudioTrack(audioSource)
          }
          await output.start()
          started = { output, videoSource }
          break
        } catch (err) {
          lastMessage =
            err instanceof Error && err.message
              ? err.message
              : 'Could not start recording on this browser.'
        }
      }

      if (!started) {
        videoEl.pause()
        videoEl.srcObject = null
        return { kind: 'failed', message: lastMessage }
      }

      canvasRef.current = canvas
      ctxRef.current = ctx
      videoElRef.current = videoEl
      outputRef.current = started.output
      videoSourceRef.current = started.videoSource
      startTimeRef.current = performance.now()
      framesRef.current = 0

      let lastFrameTime = 0
      const frameInterval = 1000 / 30
      const videoSource = started.videoSource
      const output = started.output

      const tick = (now: number) => {
        rafRef.current = requestAnimationFrame(tick)
        if (output.state !== 'started') return
        if (!videoEl.videoWidth) return
        if (now - lastFrameTime < frameInterval) return
        lastFrameTime = now
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
        const ts = framesRef.current / 30
        videoSource.add(ts, 1 / 30)
        framesRef.current++
      }

      rafRef.current = requestAnimationFrame(tick)
      durationIntervalRef.current = setInterval(() => {
        setDuration(Math.floor((performance.now() - startTimeRef.current) / 1000))
      }, 1000)
      setRecording(true)
      return { kind: 'ok' }
    } catch {
      resetLoop()
      return { kind: 'failed', message: 'Could not start recording.' }
    }
  }, [])

  const stop = useCallback(async (): Promise<RecorderStop> => {
    const output = outputRef.current
    if (!output) {
      setRecording(false)
      setDuration(0)
      return { kind: 'idle' }
    }

    resetLoop()

    try {
      await output.finalize()
    } catch {
      outputRef.current = null
      setRecording(false)
      setDuration(0)
      return { kind: 'empty' }
    }

    const buffer = output.target.buffer
    if (buffer) {
      const ext = output.format.mimeType?.includes('webm') ? 'webm' : 'mp4'
      const blob = new Blob([buffer], { type: output.format.mimeType ?? 'video/mp4' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peercall-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      outputRef.current = null
      setRecording(false)
      setDuration(0)
      return { kind: 'saved' }
    }

    outputRef.current = null
    setRecording(false)
    setDuration(0)
    return { kind: 'empty' }
  }, [])

  return { recording, duration, start, stop }
}
