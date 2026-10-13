export type MediaKind = 'camera' | 'mic' | 'speaker'

export type DeviceEntry = {
  kind: MediaKind
  deviceId: string
  label: string
  groupId: string
}

export type DeviceList = {
  cameras: DeviceEntry[]
  mics: DeviceEntry[]
  speakers: DeviceEntry[]
}

export const emptyDeviceList: DeviceList = { cameras: [], mics: [], speakers: [] }

const VIRTUAL_IDS = new Set(['default', 'communications'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type RawDevice = {
  kind: 'videoinput' | 'audioinput' | 'audiooutput'
  deviceId: string
  label: string
  groupId: string
}

function parseRawDevice(value: unknown): RawDevice | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const deviceId = value.deviceId
  if (kind !== 'videoinput' && kind !== 'audioinput' && kind !== 'audiooutput') return null
  if (typeof deviceId !== 'string' || deviceId.length === 0) return null
  const label = typeof value.label === 'string' ? value.label : ''
  const groupId = typeof value.groupId === 'string' ? value.groupId : ''
  return { kind, deviceId, label, groupId }
}

function mediaKind(kind: RawDevice['kind']): MediaKind {
  switch (kind) {
    case 'videoinput':
      return 'camera'
    case 'audioinput':
      return 'mic'
    case 'audiooutput':
      return 'speaker'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function fallbackLabel(args: { kind: MediaKind; deviceId: string }): string {
  const short = args.deviceId.slice(0, 4)
  switch (args.kind) {
    case 'camera':
      return `Camera ${short}`
    case 'mic':
      return `Mic ${short}`
    case 'speaker':
      return `Speaker ${short}`
    default: {
      const _exhaustive: never = args.kind
      return _exhaustive
    }
  }
}

function displayLabel(device: RawDevice): string {
  const stripped = device.label.replace(/^(Default|Communications)\s*[-–—]\s*/i, '').trim()
  if (stripped) return stripped
  return fallbackLabel({ kind: mediaKind(device.kind), deviceId: device.deviceId })
}

function dedupeKind(devices: RawDevice[]): DeviceEntry[] {
  const byId = new Map<string, RawDevice>()
  for (const device of devices) {
    if (!byId.has(device.deviceId)) byId.set(device.deviceId, device)
  }
  const unique = [...byId.values()]
  const hardware = unique.filter((d) => !VIRTUAL_IDS.has(d.deviceId))
  const virtual = unique.filter((d) => VIRTUAL_IDS.has(d.deviceId))
  const hardwareGroups = new Set(hardware.map((d) => d.groupId).filter(Boolean))
  const keepVirtual = virtual.filter((d) => !d.groupId || !hardwareGroups.has(d.groupId))

  const seenLabels = new Set<string>()
  const out: DeviceEntry[] = []
  for (const device of [...hardware, ...keepVirtual]) {
    const kind = mediaKind(device.kind)
    const label = displayLabel(device)
    const key = label.toLowerCase()
    if (seenLabels.has(key)) continue
    seenLabels.add(key)
    out.push({ kind, deviceId: device.deviceId, label, groupId: device.groupId })
  }
  return out
}

/** Validate `enumerateDevices()` output and drop duplicate default/comms entries. */
export function parseDeviceList(list: unknown): DeviceList {
  if (!Array.isArray(list)) return emptyDeviceList
  const parsed: RawDevice[] = []
  for (const item of list) {
    const device = parseRawDevice(item)
    if (device) parsed.push(device)
  }
  return {
    cameras: dedupeKind(parsed.filter((d) => d.kind === 'videoinput')),
    mics: dedupeKind(parsed.filter((d) => d.kind === 'audioinput')),
    speakers: dedupeKind(parsed.filter((d) => d.kind === 'audiooutput')),
  }
}

export function activeDeviceId(args: { stream: MediaStream | null; kind: 'video' | 'audio' }): string | null {
  if (!args.stream) return null
  const tracks = args.kind === 'video' ? args.stream.getVideoTracks() : args.stream.getAudioTracks()
  const id = tracks[0]?.getSettings().deviceId
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function labelFor(args: { devices: DeviceEntry[]; deviceId: string | null; fallback: string }): string {
  if (!args.deviceId) return args.fallback
  return args.devices.find((d) => d.deviceId === args.deviceId)?.label ?? args.fallback
}

export function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}
