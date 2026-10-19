import { describe, expect, test } from 'bun:test'
import { reacquireConstraints } from './media'
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
