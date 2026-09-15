// 本文件仅在 data: 独立源的沙箱 iframe 中执行。
// rrwebPlayer 来自同一文档内的固定版本脚本，不访问管理端的 DOM、Cookie 或存储。
let player
let channel
let duration = 0
let currentTime = 0
let playing = false
let lastUpdate = 0
let firstSnapshotTime = 0

function notify(type, extra = {}) {
  parent.postMessage({ channel, type, ...extra }, '*')
}

function updateState(force = false) {
  const now = performance.now()
  if (!force && now - lastUpdate < 100) return
  lastUpdate = now
  notify('state', { currentTime: Math.min(duration, Math.max(0, currentTime)), playing })
}

function resize() {
  if (!player) return
  player.$set({ width: innerWidth, height: innerHeight })
  requestAnimationFrame(() => player?.triggerResize())
}

addEventListener('message', async (event) => {
  if (event.source !== parent || !event.data || event.data.channel !== 'monitor-replay') return
  const data = event.data
  try {
    if (data.type === 'init' && !player) {
      channel = data.channel
      player = new rrwebPlayer({
        target: document.getElementById('player'),
        props: {
          events: data.events,
          width: innerWidth,
          height: innerHeight,
          autoPlay: false,
          showController: false,
          skipInactive: false,
          speedOption: [0.5, 1, 2, 4],
          speed: 1,
          maxScale: 1,
          triggerFocus: false,
          mouseTail: false,
          UNSAFE_replayCanvas: true,
        },
      })
      // Svelte 的内置 Controller 在下一次微任务挂载后才可调用。
      await Promise.resolve()
      duration = player.getMetaData().totalTime
      firstSnapshotTime =
        data.events.find((event) => event.type === 2).timestamp - data.events[0].timestamp
      player.addEventListener('ui-update-current-time', ({ payload }) => {
        currentTime = payload
        updateState()
      })
      player.addEventListener('ui-update-player-state', ({ payload }) => {
        playing = payload === 'playing'
        updateState(true)
      })
      player.addEventListener('finish', () => {
        playing = false
        currentTime = duration
        updateState(true)
      })
      // Meta 与首个完整快照之间可能相差几毫秒，预览不能停在快照之前。
      player.goto(firstSnapshotTime, false)
      notify('ready')
      return
    }
    if (!player) return
    if (data.type === 'play') player.play()
    if (data.type === 'pause') player.pause()
    if (data.type === 'seek' && Number.isFinite(data.time)) {
      currentTime = Math.min(duration, Math.max(firstSnapshotTime, data.time))
      player.goto(currentTime, false)
      playing = false
      updateState(true)
    }
    if (data.type === 'speed' && [0.5, 1, 2, 4].includes(data.speed)) player.setSpeed(data.speed)
  } catch {
    notify('error')
  }
})

addEventListener('resize', resize)
addEventListener('pagehide', () => {
  if (!player) return
  const replayer = player.getReplayer()
  player.pause()
  player.$destroy()
  replayer.destroy()
  player = undefined
})
addEventListener('error', () => notify('error'))
addEventListener('unhandledrejection', () => notify('error'))
