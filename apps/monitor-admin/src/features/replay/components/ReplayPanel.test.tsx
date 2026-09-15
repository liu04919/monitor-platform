import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayPanel } from './ReplayPanel'
import { loadReplay } from '../model/loadReplay'
import { REPLAY_CHANNEL } from '../model/replayTypes'

vi.mock('../model/loadReplay', () => ({ loadReplay: vi.fn() }))
vi.mock('../player/frameDocument', () => ({
  createFrameSource: () => 'data:text/html,<body>replay</body>',
}))
const clip = { events: [], startTime: 1000, endTime: 6000, width: 1440, height: 900 }

function renderPanel(value: string | null = 'recording') {
  return render(
    <MantineProvider env="test">
      <ReplayPanel replayData={value} timestamp={5500} />
    </MantineProvider>,
  )
}
async function readyPlayer() {
  const frame = (await screen.findByTitle('录屏回放画面')) as HTMLIFrameElement
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { channel: REPLAY_CHANNEL, type: 'ready' },
      }),
    ),
  )
  return frame
}

describe('ReplayPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadReplay).mockResolvedValue(clip)
  })
  it('没有录屏时不启动解压', () => {
    renderPanel(null)
    expect(screen.getByText('此事件未附带录屏。')).toBeInTheDocument()
    expect(loadReplay).not.toHaveBeenCalled()
    expect(screen.queryByTitle('录屏回放画面')).not.toBeInTheDocument()
  })
  it('错误后可以重新加载', async () => {
    vi.mocked(loadReplay).mockRejectedValueOnce(new Error('录屏损坏'))
    renderPanel()
    expect(await screen.findByText('录屏损坏')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载录屏' }))
    await readyPlayer()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('只接收播放器窗口消息，并发出播放、跳转、倍速命令', async () => {
    renderPanel()
    const frame = await readyPlayer()
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(frame.getAttribute('src')).toMatch(/^data:/)
    const send = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { channel: REPLAY_CHANNEL, type: 'error' },
        }),
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^播放$/ }))
    expect(send).toHaveBeenLastCalledWith({ channel: REPLAY_CHANNEL, type: 'play' }, '*')
    fireEvent.change(screen.getByRole('slider'), { target: { value: '2000' } })
    expect(send).toHaveBeenLastCalledWith(
      { channel: REPLAY_CHANNEL, type: 'seek', time: 2000 },
      '*',
    )
    fireEvent.change(screen.getByLabelText('播放速度'), { target: { value: '2' } })
    expect(send).toHaveBeenLastCalledWith({ channel: REPLAY_CHANNEL, type: 'speed', speed: 2 }, '*')
  })
  it('卸载后中止解压且移除回放 iframe', async () => {
    const view = renderPanel()
    await readyPlayer()
    const signal = vi.mocked(loadReplay).mock.calls[0][1]
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(document.querySelector('iframe')).toBeNull()
  })
  it('播放异常不保留 iframe', async () => {
    renderPanel()
    const frame = await readyPlayer()
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { channel: REPLAY_CHANNEL, type: 'error' },
        }),
      ),
    )
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('回放失败'))
    expect(screen.queryByTitle('录屏回放画面')).not.toBeInTheDocument()
  })
})
