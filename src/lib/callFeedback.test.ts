import { expect, test } from 'bun:test'
import { fitFrame } from './screenshot'
import { tileSlots } from './tileSlots'
import { parseDeviceList } from './devices'

test('portrait and 4:3 screenshots preserve source proportions', () => {
  expect(fitFrame(480, 640, 640, 360)).toEqual({x: 185, y: 0, width: 270, height: 360})
  const f = fitFrame(640, 480, 640, 360)
  expect(f.width / f.height).toBe(640 / 480)
  expect(f.x).toBe(80)
})
test('only hardware identifier suffixes are removed from device labels', () => {
  const devices = parseDeviceList([
    {kind:'videoinput',deviceId:'a',groupId:'a',label:'FaceTime HD Camera (4E23:4E8C)'},
    {kind:'videoinput',deviceId:'b',groupId:'b',label:'Camera (Virtual)'},
  ])
  expect(devices.cameras.map(d => d.label)).toEqual(['FaceTime HD Camera', 'Camera (Virtual)'])
})
test('centered short rows and spotlight share one stable list of tile slots', () => {
  const grid = tileSlots(['a','b','c','d','e'], {mode:'grid', cols:3, rows:2})
  expect(grid.slots.d.column).toBe('2 / span 2')
  expect(grid.slots.e.column).toBe('4 / span 2')
  const stage = tileSlots(['a','b','c'], {mode:'spotlight',stageId:'b'})
  expect(Object.keys(stage.slots).sort()).toEqual(['a','b','c'])
  expect(stage.slots.b.variant).toBe('stage')
  expect(stage.slots.a.row).toBe('2')
})
