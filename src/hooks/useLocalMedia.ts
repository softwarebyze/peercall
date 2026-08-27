import { useCallback, useEffect, useRef, useState } from 'react'

export type MediaHandoff =
  | { kind: 'stream'; stream: MediaStream; cameraOn: boolean; micOn: boolean }
  | { kind: 'listen' }

export type LocalMediaState =
  | { kind: 'pending' }
  | { kind: 'live'; stream: MediaStream; hasVideo: boolean; hasAudio: boolean }
  | { kind: 'blocked'; reason: 'denied' | 'missing' | 'unknown'; message: string }

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string') {
    return err.name
  }
  return ''
}

function classify(err: unknown): { reason: 'denied' | 'missing' | 'unknown'; message: string } {
  const name = errorName(err)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { reason: 'denied', message: 'Camera/mic access denied.' }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { reason: 'missing', message: 'No camera or mic found on this device.' }
  }
  return { reason: 'unknown', message: 'Could not access camera or mic.' }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export function useLocalMedia() {
  const [state, setState] = useState<LocalMediaState>({ kind: 'pending' })
  const streamRef = useRef<MediaStream | null>(null)
  const handedOff = useRef(false)

  const applyStream = (stream: MediaStream) => {
    stopStream(streamRef.current)
    streamRef.current = stream
    setState({
      kind: 'live',
      stream,
      hasVideo: stream.getVideoTracks().length > 0,
      hasAudio: stream.getAudioTracks().length > 0,
    })
  }

  const acquire = useCallback(async (args: { video: boolean; audio: boolean }) => {
    setState({ kind: 'pending' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: args.video,
        audio: args.audio,
      })
      applyStream(stream)
    } catch (err) {
      if (args.video && args.audio) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
          applyStream(audioOnly)
          return
        } catch (audioErr) {
          stopStream(streamRef.current)
          streamRef.current = null
          setState({ kind: 'blocked', ...classify(audioErr) })
          return
        }
      }
      stopStream(streamRef.current)
      streamRef.current = null
      setState({ kind: 'blocked', ...classify(err) })
    }
  }, [])

  useEffect(() => {
    void acquire({ video: true, audio: true })
    return () => {
      if (!handedOff.current) stopStream(streamRef.current)
    }
  }, [acquire])

  const retry = useCallback(() => {
    handedOff.current = false
    void acquire({ video: true, audio: true })
  }, [acquire])

  const audioOnly = useCallback(() => {
    handedOff.current = false
    void acquire({ video: false, audio: true })
  }, [acquire])

  const handoff = useCallback(
    (args: { cameraOn: boolean; micOn: boolean; listen: boolean }): MediaHandoff => {
      handedOff.current = true
      if (args.listen || state.kind !== 'live') return { kind: 'listen' }
      state.stream.getVideoTracks().forEach((t) => {
        t.enabled = args.cameraOn
      })
      state.stream.getAudioTracks().forEach((t) => {
        t.enabled = args.micOn
      })
      return {
        kind: 'stream',
        stream: state.stream,
        cameraOn: args.cameraOn,
        micOn: args.micOn,
      }
    },
    [state],
  )

  return { state, retry, audioOnly, handoff }
}
