import { Button, Group, Loader, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { formatTime } from '@/shared/lib/dateFormat'
import { REPLAY_CHANNEL, type PlaybackState, type ReplayClip } from '../model/replayTypes'
import { ReplayError } from './ReplayError'
import styles from './ReplayPanel.module.css'

function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function ReplayPlayer({
  clip,
  frameSource,
  timestamp,
  onRetry,
}: {
  clip: ReplayClip
  frameSource: string
  timestamp: number
  onRetry: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playback, setPlayback] = useState<PlaybackState>({ currentTime: 0, playing: false })
  const [speed, setSpeed] = useState('1')
  const duration = clip.endTime - clip.startTime
  const firstSnapshotTime =
    (clip.events.find((event) => event.type === 2)?.timestamp ?? clip.startTime) - clip.startTime

  useEffect(() => {
    const timeout = setTimeout(() => setFailed(true), 10_000)
    const receive = (event: MessageEvent) => {
      // 沙箱的 origin 是 null，必须校验窗口身份，不能只检查 origin。
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.data?.channel !== REPLAY_CHANNEL
      )
        return
      const data = event.data
      if (data.type === 'ready') {
        clearTimeout(timeout)
        setReady(true)
      }
      if (data.type === 'error') {
        clearTimeout(timeout)
        setFailed(true)
      }
      if (
        data.type === 'state' &&
        Number.isFinite(data.currentTime) &&
        typeof data.playing === 'boolean'
      ) {
        setPlayback({
          currentTime: Math.max(0, Math.min(duration, data.currentTime)),
          playing: data.playing,
        })
      }
    }
    window.addEventListener('message', receive)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
    }
  }, [duration])

  function command(type: string, values: Record<string, unknown> = {}) {
    frameRef.current?.contentWindow?.postMessage({ channel: REPLAY_CHANNEL, type, ...values }, '*')
  }

  if (failed) return <ReplayError message="回放失败，请重新加载录屏。" onRetry={onRetry} />
  return (
    <section className={styles.player} aria-label="事件录屏">
      <div className={styles.heading}>
        <div>
          <h2>事件录屏</h2>
          <p>
            {formatTime(clip.startTime)} — {formatTime(clip.endTime, false)}
            <span>
              {' '}
              · {clip.width} × {clip.height}
            </span>
          </p>
        </div>
        <Text size="xs" c="dimmed">
          事件发生于 {formatTime(timestamp, false)}
        </Text>
      </div>
      <div className={styles.stage}>
        {!ready ? (
          <div className={styles.loading} role="status">
            <Loader size="sm" />
            <span>正在还原页面…</span>
          </div>
        ) : null}
        <iframe
          ref={frameRef}
          title="录屏回放画面"
          className={styles.frame}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          src={frameSource}
          onLoad={() => command('init', { events: clip.events })}
        />
        {ready && !playback.playing && playback.currentTime <= firstSnapshotTime && duration > 0 ? (
          <Button className={styles.startButton} size="md" onClick={() => command('play')}>
            <span aria-hidden="true">▶</span>播放录屏
          </Button>
        ) : null}
      </div>
      <div className={styles.controls}>
        <Group gap="sm" wrap="nowrap">
          <Button
            size="xs"
            disabled={!ready || duration === 0}
            onClick={() => command(playback.playing ? 'pause' : 'play')}
          >
            {playback.playing ? '暂停' : '播放'}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            disabled={!ready}
            onClick={() => command('seek', { time: 0 })}
          >
            回到开头
          </Button>
        </Group>
        <span className={styles.time}>{durationLabel(playback.currentTime)}</span>
        <input
          className={styles.progress}
          type="range"
          aria-label="录屏播放进度"
          aria-valuetext={`${(playback.currentTime / 1000).toFixed(1)} 秒，共 ${(duration / 1000).toFixed(1)} 秒`}
          min={0}
          max={duration || 1}
          step={1}
          value={playback.currentTime}
          disabled={!ready || duration === 0}
          onChange={(event) => {
            const currentTime = Number(event.target.value)
            setPlayback({ currentTime, playing: false })
            command('seek', { time: currentTime })
          }}
        />
        <span className={styles.time}>{durationLabel(duration)}</span>
        <select
          className={styles.speed}
          aria-label="播放速度"
          value={speed}
          disabled={!ready}
          onChange={(event) => {
            setSpeed(event.target.value)
            command('speed', { speed: Number(event.target.value) })
          }}
        >
          {[0.5, 1, 2, 4].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
