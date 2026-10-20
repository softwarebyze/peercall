import { describe, expect, test } from 'bun:test'
import { findLocalTrack, reacquireConstraints } from './media'
import type { MediaHandoff } from '../hooks/useLocalMedia'

function handoff(hasVideo: boolean): MediaHandoff {
  const stream = {
    getVideoTracks: () => (hasVideo ? [{}] : []),
    getAudioTracks: () => [{}],
  } as unknown as MediaStream
  return { kind: 'stream', stream, cameraOn: true, micOn: true }
}

describe('reacquireConstraints', () => {
  test('requests camera and mic when there is no handoff', () => {
    expect(reacquireConstraints(null)).toEqual({ video: true, audio: true })
  })

  test('keeps video for a handoff that had a camera', () => {
    expect(reacquireConstraints(handoff(true))).toEqual({ video: true, audio: true })
  })

  test('stays audio-only for an audio-only handoff so rejoin cannot block on the camera', () => {
    expect(reacquireConstraints(handoff(false))).toEqual({ video: false, audio: true })
  })
})

describe('findLocalTrack', () => {
  const video = { kind: 'video' } as MediaStreamTrack
  const stream = {
    getVideoTracks: () => [video],
    getAudioTracks: () => [],
  } as unknown as MediaStream

  test('returns the track a switch would replace', () => {
    expect(findLocalTrack(stream, 'video')).toBe(video)
  })

  test('returns null when the call never published that kind', () => {
    expect(findLocalTrack(stream, 'audio')).toBeNull()
  })

  test('returns null without a stream', () => {
    expect(findLocalTrack(null, 'video')).toBeNull()
  })
})
