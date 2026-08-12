import { MonitorContext } from '../types'

function getSnapshot(ctx: MonitorContext) {
  return {
    pageUrl: window.location.href,
    eventData: ctx.getRecordScreenData(),
    state: ctx.getBehaviorState(),
  }
}

export default function crashLoop(ctx: MonitorContext): void {
  if (!window.Worker) {
    console.error('当前浏览器不支持 Web Worker')
    return
  }

  let worker: Worker | null = null

  const postWorkerMessage = (type: string): void => {
    if (!worker) {
      return
    }

    try {
      worker.postMessage({
        type,
        ...getSnapshot(ctx),
      })
    } catch {
      worker.postMessage({
        type,
        pageUrl: window.location.href,
        eventData: [],
        state: [],
      })
    }
  }

  const { userId, url } = ctx.getConfig()

  const workerCode = `
    const HEARTBEAT_INTERVAL = 5000;
    const CRASH_TIMEOUT = 15000;

    let reportUrl = '';
    let userId = 'unknown';

    let pageUrl = '';
    let latestEventData = [];
    let latestState = [];

    let intervalId = null;
    let crashed = false;
    let lastResponseTime = performance.now();

    function updateConfig(data) {
      if (data.url) {
        reportUrl = data.url;
      }

      if (data.id) {
        userId = data.id;
      }
    }

    function updateSnapshot(data) {
      if (data.pageUrl) {
        pageUrl = data.pageUrl;
      }

      if (data.eventData) {
        latestEventData = data.eventData;
      }

      if (data.state) {
        latestState = data.state;
      }
    }

    function stopHeartbeat() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function reportError(reason) {
      if (crashed || !reportUrl) {
        return;
      }

      crashed = true;

      const data = {
        type: 'exception',
        subType: 'crash',
        pageUrl,
        timestamp: Date.now(),
        reason,
        eventData: latestEventData,
        state: latestState
      };

      const reportData = {
        userId: userId || 'unknown',
        data: [data]
      };

      fetch(reportUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reportData),
        keepalive: true
      }).catch((error) => {
        console.error('Error sending crash report:', error);
      });
    }

    function checkCrash(reason) {
      const now = performance.now();
      const noResponseDuration = now - lastResponseTime;

      if (noResponseDuration < CRASH_TIMEOUT) {
        return false;
      }

      reportError(reason);
      stopHeartbeat();
      return true;
    }

    function sendHeartbeat() {
      if (crashed) {
        return;
      }

      postMessage({
        type: 'heartbeat'
      });
    }

    onmessage = (event) => {
      const data = event.data || {};
      const { type } = data;

      if (type === 'init') {
        updateConfig(data);
        updateSnapshot(data);
        return;
      }

      if (type === 'heartbeat-response') {
        lastResponseTime = performance.now();
        updateSnapshot(data);
        return;
      }

      if (type === 'page-unload') {
        updateSnapshot(data);
        checkCrash('page-unload');
        stopHeartbeat();
        close();
      }
    };

    intervalId = setInterval(() => {
      const hasCrashed = checkCrash('heartbeat-timeout');

      if (!hasCrashed) {
        sendHeartbeat();
      }
    }, HEARTBEAT_INTERVAL);
  `

  const workerBlob = new Blob([workerCode], {
    type: 'application/javascript',
  })

  const workerUrl = URL.createObjectURL(workerBlob)
  worker = new Worker(workerUrl)
  URL.revokeObjectURL(workerUrl)

  worker.postMessage({
    type: 'init',
    id: userId,
    url,
    ...getSnapshot(ctx),
  })

  worker.onmessage = (event: MessageEvent) => {
    const { type } = event.data || {}

    if (type === 'heartbeat') {
      postWorkerMessage('heartbeat-response')
    }
  }

  ctx.on(
    window,
    'beforeunload',
    () => {
      postWorkerMessage('page-unload')
      worker = null
    },
    { once: true },
  )

  ctx.addDispose(() => {
    worker?.terminate()
    worker = null
  })
}
