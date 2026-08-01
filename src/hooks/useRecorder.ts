import { useRef, useState, useCallback } from 'react'

export interface RecorderState {
  recording: boolean
  duration: number
  start: (stream: MediaStream) => void
  stop: () => void
}

export function useRecorder(): RecorderState {
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const outputRef = useRef<any>(null)
  const rafRef = useRef(0)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const framesRef = useRef(0)
  const startTimeRef = useRef(0)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const videoSourceRef = useRef<any>(null)

  const start = useCallback(async (stream: MediaStream) => {
    const {
      Output,
      Mp4OutputFormat,
      BufferTarget,
      CanvasSource,
      MediaStreamAudioTrackSource,
    } = await import('mediabunny')

    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    })

    const videoTrack = stream.getVideoTracks()[0]
    const audioTrack = stream.getAudioTracks()[0]

    // Canvas to capture video frames
    const canvas = document.createElement('canvas')
    const videoSettings = videoTrack?.getSettings()
    canvas.width = videoSettings?.width ?? 1280
    canvas.height = videoSettings?.height ?? 720
    const ctx = canvas.getContext('2d')!

    canvasRef.current = canvas
    ctxRef.current = ctx

    // Hidden video element to render the track
    const videoEl = document.createElement('video')
    videoEl.srcObject = new MediaStream(videoTrack ? [videoTrack] : [])
    videoEl.muted = true
    videoEl.playsInline = true
    videoElRef.current = videoEl
    await videoEl.play()

    // Set up video source from canvas
    const videoSource = new CanvasSource(canvas, {
      codec: 'av1',
      bitrate: 2_000_000,
    })

    output.addVideoTrack(videoSource, { frameRate: 30 })
    videoSourceRef.current = videoSource

    // Set up audio source if available
    if (audioTrack) {
      const audioSource = new MediaStreamAudioTrackSource(audioTrack, {
        codec: 'opus',
        bitrate: 128_000,
      })
      output.addAudioTrack(audioSource)
    }

    await output.start()
    outputRef.current = output
    startTimeRef.current = performance.now()
    framesRef.current = 0

    // Single RAF loop: draw to canvas AND feed frame to encoder in sync
    let lastFrameTime = 0
    const frameInterval = 1000 / 30

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick)

      if (output.state !== 'started') return
      if (!videoEl.videoWidth) return // not ready yet

      // Throttle to 30fps — skip if not enough time has passed
      if (now - lastFrameTime < frameInterval) return
      lastFrameTime = now

      // Draw current video frame to canvas (synchronous, fast)
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)

      // Feed the canvas frame to the encoder
      const ts = framesRef.current / 30
      videoSource.add(ts, 1 / 30)
      framesRef.current++
    }

    rafRef.current = requestAnimationFrame(tick)

    // Duration counter — lightweight, just updates display
    durationIntervalRef.current = setInterval(() => {
      setDuration(Math.floor((performance.now() - startTimeRef.current) / 1000))
    }, 1000)

    setRecording(true)
  }, [])

  const stop = useCallback(async () => {
    if (!outputRef.current) return

    // Stop the RAF loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    // Stop the duration counter
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    // Stop the hidden video element
    if (videoElRef.current) {
      videoElRef.current.pause()
      videoElRef.current.srcObject = null
      videoElRef.current = null
    }

    canvasRef.current = null
    ctxRef.current = null

    const output = outputRef.current
    await output.finalize()

    const buffer: ArrayBuffer | null = output.target.buffer
    if (buffer) {
      const ext = output.format.mimeType?.includes('mp4') ? 'mp4' : 'webm'
      const blob = new Blob([buffer], { type: output.format.mimeType ?? 'video/mp4' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peercall-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    }

    outputRef.current = null
    videoSourceRef.current = null
    framesRef.current = 0
    setRecording(false)
    setDuration(0)
  }, [])

  return { recording, duration, start, stop }
}
