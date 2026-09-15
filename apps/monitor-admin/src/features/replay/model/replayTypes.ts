export interface ReplayEvent {
  type: number
  timestamp: number
  data: Record<string, unknown>
}

export interface ReplayClip {
  events: ReplayEvent[]
  startTime: number
  endTime: number
  width: number
  height: number
}

export type DecodeResult = { clip: ReplayClip; error?: never } | { error: string; clip?: never }

export const REPLAY_CHANNEL = 'monitor-replay'

export interface PlaybackState {
  currentTime: number
  playing: boolean
}
