import { Loader, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { loadReplay } from '../model/loadReplay'
import type { ReplayClip } from '../model/replayTypes'
import { ReplayPlayer } from './ReplayPlayer'
import { ReplayError } from './ReplayError'
import styles from './ReplayPanel.module.css'

type ReplayState =
  | { clip: ReplayClip; frameSource: string; error?: never }
  | { error: string; clip?: never }

export function ReplayPanel({
  replayData,
  timestamp,
}: {
  replayData: string | null
  timestamp: number
}) {
  const [attempt, setAttempt] = useState(0)
  if (!replayData) {
    return (
      <div className={styles.empty}>
        <h2>暂无录屏</h2>
        <p>此事件未附带录屏。</p>
      </div>
    )
  }
  return (
    <LoadReplay
      key={attempt}
      replayData={replayData}
      timestamp={timestamp}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  )
}

function LoadReplay({
  replayData,
  timestamp,
  onRetry,
}: {
  replayData: string
  timestamp: number
  onRetry: () => void
}) {
  const [state, setState] = useState<ReplayState | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // 播放器脚本与解码并行准备；此组件仅在录屏页签打开时挂载。
    Promise.all([loadReplay(replayData, controller.signal), import('../player/frameDocument')])
      .then(([clip, frame]) => {
        if (!controller.signal.aborted) setState({ clip, frameSource: frame.createFrameSource() })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            error: error instanceof Error ? error.message : '播放器加载失败，请重新加载。',
          })
      })
    return () => controller.abort()
  }, [replayData])

  if (!state)
    return (
      <Stack className={styles.empty} align="center" justify="center" role="status">
        <Loader size="sm" />
        <Text size="sm">正在加载录屏…</Text>
      </Stack>
    )
  if (state.error) return <ReplayError message={state.error} onRetry={onRetry} />
  if (!state.clip) return null
  return (
    <ReplayPlayer
      clip={state.clip}
      frameSource={state.frameSource}
      timestamp={timestamp}
      onRetry={onRetry}
    />
  )
}
