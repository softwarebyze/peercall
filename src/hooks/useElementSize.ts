import { useEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Track an element's rendered size with a ResizeObserver.
 *
 * Returns a callback ref (attach it to the element) plus the current size. A
 * callback ref — not a RefObject — so the observer follows the element across
 * the conditionals this app renders (a solo preview turning into a grid), which
 * a `useEffect(..., [])` on a RefObject would miss.
 */
export function useElementSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  useEffect(() => {
    if (!node) return
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [setNode, size] as const
}
