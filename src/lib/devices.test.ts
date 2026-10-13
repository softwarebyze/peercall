import { describe, expect, test } from 'bun:test'
import { parseDeviceList } from './devices'

describe('parseDeviceList', () => {
  test('drops empty ids, default/comms duplicates, and duplicate labels', () => {
    const list = [
      { kind: 'audioinput', deviceId: '', label: 'Before permission', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Built-in Mic', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'communications', label: 'Communications - Built-in Mic', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'mic-real', label: 'Built-in Mic', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'mic-real-copy', label: 'Built-in Mic', groupId: 'g1' },
      { kind: 'videoinput', deviceId: 'cam-1', label: 'FaceTime HD', groupId: 'g2' },
      { kind: 'audiooutput', deviceId: 'spk-1', label: 'Mac Speakers', groupId: 'g3' },
      { kind: 'not-a-kind', deviceId: 'x', label: 'nope', groupId: 'g4' },
    ]
    const devices = parseDeviceList(list)
    expect(devices.mics.map((d) => d.deviceId)).toEqual(['mic-real'])
    expect(devices.cameras.map((d) => d.label)).toEqual(['FaceTime HD'])
    expect(devices.speakers.map((d) => d.label)).toEqual(['Mac Speakers'])
  })

  test('keeps a virtual default when it is the only device', () => {
    const devices = parseDeviceList([
      { kind: 'audiooutput', deviceId: 'default', label: 'Default', groupId: '' },
    ])
    expect(devices.speakers).toHaveLength(1)
    expect(devices.speakers[0]?.deviceId).toBe('default')
  })

  test('rejects non-arrays', () => {
    expect(parseDeviceList(null)).toEqual({ cameras: [], mics: [], speakers: [] })
  })
})
