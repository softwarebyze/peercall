declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module 'mediabunny' {
  export class Output {
    constructor(opts: any)
    state: string
    format: { mimeType: string }
    target: { buffer: ArrayBuffer | null }
    addVideoTrack(source: any, opts?: any): any
    addAudioTrack(source: any, opts?: any): any
    start(): Promise<void>
    finalize(): Promise<void>
    cancel(): Promise<void>
    getMimeType(): Promise<string>
  }
  export class BufferTarget {
    constructor(opts?: any)
    buffer: ArrayBuffer | null
  }
  export class CanvasSource {
    constructor(canvas: HTMLCanvasElement, opts?: any)
    add(timestamp: number, duration: number): void
  }
  export class MediaStreamAudioTrackSource {
    constructor(track: MediaStreamTrack, opts?: any)
  }
  export class StreamTarget {
    constructor(writable: WritableStream, opts?: any)
  }
  export class Mp4OutputFormat {
    constructor(opts?: any)
  }
  export class WebMOutputFormat {
    constructor(opts?: any)
  }
}
