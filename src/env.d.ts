declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module 'mediabunny' {
  export class Output {
    constructor(opts: unknown)
    state: string
    format: { mimeType: string }
    target: { buffer: ArrayBuffer | null }
    addVideoTrack(source: unknown, opts?: unknown): unknown
    addAudioTrack(source: unknown, opts?: unknown): unknown
    start(): Promise<void>
    finalize(): Promise<void>
    cancel(): Promise<void>
    getMimeType(): Promise<string>
  }
  export class BufferTarget {
    constructor(opts?: unknown)
    buffer: ArrayBuffer | null
  }
  export class CanvasSource {
    constructor(canvas: HTMLCanvasElement, opts?: unknown)
    add(timestamp: number, duration: number): void
  }
  export class MediaStreamAudioTrackSource {
    constructor(track: MediaStreamTrack, opts?: unknown)
  }
  export class StreamTarget {
    constructor(writable: WritableStream, opts?: unknown)
  }
  export class Mp4OutputFormat {
    constructor(opts?: unknown)
  }
  export class WebMOutputFormat {
    constructor(opts?: unknown)
  }
}
