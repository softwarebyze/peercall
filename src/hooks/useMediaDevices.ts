import { useCallback, useEffect, useState } from 'react'
import { emptyDeviceList, parseDeviceList, type DeviceList } from '../lib/devices'

export function useMediaDevices(args: { stream: MediaStream | null }): DeviceList {
  const [devices, setDevices] = useState<DeviceList>(emptyDeviceList)

  const refresh = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    void navigator.mediaDevices.enumerateDevices().then((list) => {
      setDevices(parseDeviceList(list))
    })
  }, [])

  useEffect(() => {
    refresh()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh, args.stream])

  return devices
}
