import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function svgProps({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...rest,
  }
}

export function IconMesh(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="6" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="18" r="2.2" fill="currentColor" stroke="none" />
      <path d="M8 11.2 16.2 7.2M8 12.8 16.2 16.8" />
    </svg>
  )
}

export function IconRecord(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconLock(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconChat(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 6.5h14v9H9l-4 3v-3H5z" />
    </svg>
  )
}

export function IconCamera(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="7" width="13" height="10" rx="1.5" />
      <path d="M16.5 10.5 21 8v8l-4.5-2.5z" />
    </svg>
  )
}

export function IconCameraOff(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="7" width="13" height="10" rx="1.5" />
      <path d="M16.5 10.5 21 8v8l-4.5-2.5z" />
      <path d="M4 20 20 4" />
    </svg>
  )
}

export function IconMic(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5" />
    </svg>
  )
}

export function IconMicOff(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5" />
      <path d="M4 20 20 4" />
    </svg>
  )
}

export function IconScreen(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
      <path d="M8 19.5h8M12 16v3.5" />
    </svg>
  )
}

export function IconStop(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconShot(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <rect x="3.5" y="6.5" width="17" height="11" rx="1.5" />
      <path d="M8 6.5 9.2 4.5h5.6L16 6.5" />
    </svg>
  )
}

export function IconGear(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </svg>
  )
}

export function IconQr(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <path d="M13.5 13.5h3v3h-3zM18.5 13.5v3M13.5 18.5h7M18.5 20.5" />
    </svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </svg>
  )
}

export function IconPeople(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="9" cy="8" r="2.4" />
      <path d="M4.5 17.5c.4-2.8 2.3-4.2 4.5-4.2s4.1 1.4 4.5 4.2" />
      <circle cx="16.5" cy="8.5" r="2" />
      <path d="M15 13.5c1.8.2 3.4 1.3 3.8 4" />
    </svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  )
}

export function IconWarn(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 4 21 20H3z" />
      <path d="M12 10v5M12 17.5v.5" />
    </svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 12h13M13 6l7 6-7 6" />
    </svg>
  )
}

export function IconLeave(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
      <path d="M10 12h10M16 8l4 4-4 4" />
    </svg>
  )
}

export function IconEnd(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M8 9.5c2.5-2 5.5-2 8 0M7 14.5c3.4-3 6.6-3 10 0" />
      <circle cx="12" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconSpeaker(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4.5 9.5h3L12 6v12l-4.5-3.5h-3z" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5M17.8 7.2a7 7 0 0 1 0 9.6" />
    </svg>
  )
}
